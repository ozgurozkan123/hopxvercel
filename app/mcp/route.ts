import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { AsyncLocalStorage } from "node:async_hooks";

// HOPX MCP Server - Per-connection authentication
// Each request's Bearer token is extracted and used for HOPX API calls.

// AsyncLocalStorage to pass the API key to tool handlers
const apiKeyStorage = new AsyncLocalStorage<string | null>();

// Helper to get the current API key from context
function getApiKey(): string | null {
  return apiKeyStorage.getStore() ?? null;
}

// HOPX API base URL
const HOPX_API_BASE = "https://api.hopx.ai";

// Helper to make authenticated HOPX API calls
async function hopxFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error("No HOPX API key provided. Please configure your HOPX API key in the MCP server settings.");
  }

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Content-Type", "application/json");

  const response = await fetch(`${HOPX_API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  return response;
}

// Create the MCP handler with tools
const mcpHandler = createMcpHandler(
  async (server) => {
    // ---------- System ----------
    server.registerTool(
      "health",
      {
        title: "health",
        description: "Check health status of the HOPX API and verify authentication.",
        inputSchema: z.object({}),
      },
      async () => {
        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            content: [{ type: "text", text: "Error: No HOPX API key provided. Please configure your API key in the MCP server settings." }],
          };
        }

        try {
          const response = await hopxFetch("/health");
          const data = await response.json();
          return {
            content: [{ type: "text", text: `HOPX API Status: ${JSON.stringify(data, null, 2)}\nAuthenticated: Yes (API key: ${apiKey.substring(0, 8)}...)` }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `HOPX API health check failed: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      }
    );

    // ---------- Sandboxes ----------
    server.registerTool(
      "list_sandboxes",
      {
        title: "list_sandboxes",
        description: "GET /v1/sandboxes — list all sandboxes for the authenticated user.",
        inputSchema: z.object({
          limit: z.number().optional().describe("Maximum number of sandboxes to return (default: 100)"),
          status: z.string().optional().describe("Filter by status: 'running', 'stopped', 'paused', or 'creating'"),
        }),
      },
      async ({ limit, status }) => {
        try {
          const params = new URLSearchParams();
          if (limit) params.set("limit", String(limit));
          if (status) params.set("status", status);

          const response = await hopxFetch(`/v1/sandboxes?${params.toString()}`);
          const data = await response.json();

          if (!response.ok) {
            return {
              content: [{ type: "text", text: `Error listing sandboxes: ${JSON.stringify(data)}` }],
            };
          }

          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to list sandboxes: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      }
    );

    server.registerTool(
      "create_sandbox",
      {
        title: "create_sandbox",
        description: "POST /v1/sandboxes — create a new sandbox. Use list_templates first to find available templates.",
        inputSchema: z.object({
          template_id: z.string().describe("Template ID or name (e.g., 'code-interpreter')"),
          region: z.string().optional().describe("Deployment region, e.g., 'us-east', 'eu-west'"),
          timeout_seconds: z.number().optional().describe("Auto-shutdown timeout in seconds (default: 600)"),
          internet_access: z.boolean().optional().describe("Enable internet access (default: true)"),
          env_vars: z.record(z.string()).optional().describe("Initial environment variables"),
        }),
      },
      async ({ template_id, region, timeout_seconds, internet_access, env_vars }) => {
        try {
          const response = await hopxFetch("/v1/sandboxes", {
            method: "POST",
            body: JSON.stringify({
              template: template_id,
              region,
              timeout_seconds: timeout_seconds ?? 600,
              internet_access: internet_access ?? true,
              env_vars,
            }),
          });

          const data = await response.json();

          if (!response.ok) {
            return {
              content: [{ type: "text", text: `Error creating sandbox: ${JSON.stringify(data)}` }],
            };
          }

          return {
            content: [{ type: "text", text: `Sandbox created successfully:\n${JSON.stringify(data, null, 2)}` }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to create sandbox: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      }
    );

    server.registerTool(
      "get_sandbox",
      {
        title: "get_sandbox",
        description: "GET /v1/sandboxes/{id} — get detailed sandbox information.",
        inputSchema: z.object({
          id: z.string().describe("Sandbox ID"),
        }),
      },
      async ({ id }) => {
        try {
          const response = await hopxFetch(`/v1/sandboxes/${id}`);
          const data = await response.json();

          if (!response.ok) {
            return {
              content: [{ type: "text", text: `Error getting sandbox: ${JSON.stringify(data)}` }],
            };
          }

          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to get sandbox: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      }
    );

    server.registerTool(
      "delete_sandbox",
      {
        title: "delete_sandbox",
        description: "DELETE /v1/sandboxes/{id} — permanently delete a sandbox.",
        inputSchema: z.object({
          id: z.string().describe("Sandbox ID to delete"),
        }),
      },
      async ({ id }) => {
        try {
          const response = await hopxFetch(`/v1/sandboxes/${id}`, {
            method: "DELETE",
          });

          if (!response.ok) {
            const data = await response.json();
            return {
              content: [{ type: "text", text: `Error deleting sandbox: ${JSON.stringify(data)}` }],
            };
          }

          return {
            content: [{ type: "text", text: `Sandbox ${id} deleted successfully.` }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to delete sandbox: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      }
    );

    // ---------- Templates ----------
    server.registerTool(
      "list_templates",
      {
        title: "list_templates",
        description: "GET /v1/templates — list available sandbox templates.",
        inputSchema: z.object({
          limit: z.number().optional().describe("Maximum number of templates to return (default: 10)"),
        }),
      },
      async ({ limit }) => {
        try {
          const params = new URLSearchParams();
          if (limit) params.set("limit", String(limit));

          const response = await hopxFetch(`/v1/templates?${params.toString()}`);
          const data = await response.json();

          if (!response.ok) {
            return {
              content: [{ type: "text", text: `Error listing templates: ${JSON.stringify(data)}` }],
            };
          }

          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to list templates: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      }
    );

    // ---------- Code Execution ----------
    server.registerTool(
      "execute_code",
      {
        title: "execute_code",
        description: "Execute code in a HOPX sandbox. Supports Python, JavaScript, Bash, and Go.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID to execute code in"),
          code: z.string().describe("Code to execute"),
          language: z.enum(["python", "javascript", "bash", "go"]).optional().describe("Programming language (default: python)"),
          timeout: z.number().optional().describe("Execution timeout in seconds (default: 30)"),
          env: z.record(z.string()).optional().describe("Environment variables for execution"),
          working_dir: z.string().optional().describe("Working directory"),
        }),
      },
      async ({ sandbox_id, code, language, timeout, env, working_dir }) => {
        try {
          const response = await hopxFetch(`/v1/sandboxes/${sandbox_id}/execute`, {
            method: "POST",
            body: JSON.stringify({
              code,
              language: language ?? "python",
              timeout: timeout ?? 30,
              env,
              working_dir,
            }),
          });

          const data = await response.json();

          if (!response.ok) {
            return {
              content: [{ type: "text", text: `Error executing code: ${JSON.stringify(data)}` }],
            };
          }

          return {
            content: [{ type: "text", text: `Execution result:\n${JSON.stringify(data, null, 2)}` }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to execute code: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      }
    );

    // ---------- Commands ----------
    server.registerTool(
      "run_command",
      {
        title: "run_command",
        description: "Run a shell command in a sandbox.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
          command: z.string().describe("Shell command to execute"),
          timeout: z.number().optional().describe("Command timeout in seconds (default: 30)"),
          working_dir: z.string().optional().describe("Working directory"),
          env: z.record(z.string()).optional().describe("Environment variables"),
        }),
      },
      async ({ sandbox_id, command, timeout, working_dir, env }) => {
        try {
          const response = await hopxFetch(`/v1/sandboxes/${sandbox_id}/commands/run`, {
            method: "POST",
            body: JSON.stringify({
              command,
              timeout: timeout ?? 30,
              working_dir,
              env,
            }),
          });

          const data = await response.json();

          if (!response.ok) {
            return {
              content: [{ type: "text", text: `Error running command: ${JSON.stringify(data)}` }],
            };
          }

          return {
            content: [{ type: "text", text: `Command result:\n${JSON.stringify(data, null, 2)}` }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to run command: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      }
    );

    // ---------- File Operations ----------
    server.registerTool(
      "file_read",
      {
        title: "file_read",
        description: "Read file contents from a sandbox.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
          path: z.string().describe("File path to read"),
        }),
      },
      async ({ sandbox_id, path }) => {
        try {
          const response = await hopxFetch(`/v1/sandboxes/${sandbox_id}/files/read?path=${encodeURIComponent(path)}`);
          const data = await response.json();

          if (!response.ok) {
            return {
              content: [{ type: "text", text: `Error reading file: ${JSON.stringify(data)}` }],
            };
          }

          return {
            content: [{ type: "text", text: typeof data.content === "string" ? data.content : JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to read file: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      }
    );

    server.registerTool(
      "file_write",
      {
        title: "file_write",
        description: "Write file to a sandbox.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
          path: z.string().describe("Destination file path"),
          content: z.string().describe("File content to write"),
        }),
      },
      async ({ sandbox_id, path, content }) => {
        try {
          const response = await hopxFetch(`/v1/sandboxes/${sandbox_id}/files/write`, {
            method: "POST",
            body: JSON.stringify({ path, content }),
          });

          const data = await response.json();

          if (!response.ok) {
            return {
              content: [{ type: "text", text: `Error writing file: ${JSON.stringify(data)}` }],
            };
          }

          return {
            content: [{ type: "text", text: `File written successfully: ${path}` }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to write file: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      }
    );

    server.registerTool(
      "file_list",
      {
        title: "file_list",
        description: "List directory contents in a sandbox.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
          path: z.string().optional().describe("Directory path to list (default: /workspace)"),
        }),
      },
      async ({ sandbox_id, path }) => {
        try {
          const dirPath = path ?? "/workspace";
          const response = await hopxFetch(`/v1/sandboxes/${sandbox_id}/files/list?path=${encodeURIComponent(dirPath)}`);
          const data = await response.json();

          if (!response.ok) {
            return {
              content: [{ type: "text", text: `Error listing files: ${JSON.stringify(data)}` }],
            };
          }

          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to list files: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      }
    );

    server.registerTool(
      "file_delete",
      {
        title: "file_delete",
        description: "Delete file or directory from a sandbox.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
          path: z.string().describe("Path to delete"),
        }),
      },
      async ({ sandbox_id, path }) => {
        try {
          const response = await hopxFetch(`/v1/sandboxes/${sandbox_id}/files/remove`, {
            method: "DELETE",
            body: JSON.stringify({ path }),
          });

          if (!response.ok) {
            const data = await response.json();
            return {
              content: [{ type: "text", text: `Error deleting file: ${JSON.stringify(data)}` }],
            };
          }

          return {
            content: [{ type: "text", text: `File deleted successfully: ${path}` }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to delete file: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      }
    );

    // ---------- System Metrics ----------
    server.registerTool(
      "get_system_metrics",
      {
        title: "get_system_metrics",
        description: "Get sandbox system metrics (CPU, memory, disk usage).",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
        }),
      },
      async ({ sandbox_id }) => {
        try {
          const response = await hopxFetch(`/v1/sandboxes/${sandbox_id}/metrics`);
          const data = await response.json();

          if (!response.ok) {
            return {
              content: [{ type: "text", text: `Error getting metrics: ${JSON.stringify(data)}` }],
            };
          }

          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: `Failed to get metrics: ${error instanceof Error ? error.message : String(error)}` }],
          };
        }
      }
    );
  },
  {},
  {
    basePath: "",
    verboseLogs: true,
    maxDuration: 60,
    disableSse: true,
  }
);

// Custom handler that extracts Bearer token and passes it to tool handlers
async function handleRequest(request: Request): Promise<Response> {
  // Extract Bearer token from Authorization header
  const authHeader = request.headers.get("Authorization");
  let apiKey: string | null = null;

  if (authHeader?.startsWith("Bearer ")) {
    apiKey = authHeader.slice(7); // Remove "Bearer " prefix
  }

  // Log authentication status
  console.log("[HOPX MCP] Request received", {
    hasAuth: Boolean(apiKey),
    apiKeyPrefix: apiKey ? `${apiKey.substring(0, 8)}...` : null,
    method: request.method,
    url: request.url,
  });

  // Run the MCP handler within the API key context
  return apiKeyStorage.run(apiKey, async () => {
    // @ts-expect-error - mcpHandler expects specific Request type
    return mcpHandler(request);
  });
}

// Export handlers for all HTTP methods
export async function GET(request: Request): Promise<Response> {
  return handleRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleRequest(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handleRequest(request);
}
