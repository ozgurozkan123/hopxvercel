import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { AsyncLocalStorage } from "node:async_hooks";

// HOPX MCP Server - Per-connection authentication
// Each request's Bearer token is extracted and used for HOPX API calls.
// Implements full feature parity with https://github.com/hopx-ai/mcp

// AsyncLocalStorage to pass the API key to tool handlers
const apiKeyStorage = new AsyncLocalStorage<string | null>();

// Helper to get the current API key from context
function getApiKey(): string | null {
  return apiKeyStorage.getStore() ?? null;
}

// HOPX API base URLs
const HOPX_CONTROL_PLANE = "https://api.hopx.dev";

// Request counter for tracing
let requestCounter = 0;

// Helper to truncate long strings for logging
function truncateForLog(str: string, maxLen = 500): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + `... [truncated, total ${str.length} chars]`;
}

// Helper to make authenticated HOPX Control Plane API calls
// Used for: sandbox lifecycle, templates
async function hopxFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiKey = getApiKey();
  const requestId = ++requestCounter;
  const fullUrl = `${HOPX_CONTROL_PLANE}${endpoint}`;
  const method = options.method ?? "GET";

  console.log(`[HOPX:${requestId}] ▶ REQUEST to Control Plane`, {
    url: fullUrl,
    method,
    hasApiKey: Boolean(apiKey),
    apiKeyPrefix: apiKey ? `${apiKey.substring(0, 8)}...` : null,
    body: options.body ? truncateForLog(String(options.body)) : undefined,
  });

  if (!apiKey) {
    const error = new Error("No HOPX API key provided. Please configure your HOPX API key in the MCP server settings.");
    console.error(`[HOPX:${requestId}] ✗ AUTH ERROR`, { error: error.message });
    throw error;
  }

  const headers = new Headers(options.headers);
  headers.set("X-API-Key", apiKey);
  headers.set("Content-Type", "application/json");

  const startTime = Date.now();

  try {
    const response = await fetch(fullUrl, {
      ...options,
      headers,
    });

    const duration = Date.now() - startTime;

    // Clone response to read body without consuming it
    const responseClone = response.clone();
    let responseBody: string;
    try {
      responseBody = await responseClone.text();
    } catch {
      responseBody = "[Could not read response body]";
    }

    if (response.ok) {
      console.log(`[HOPX:${requestId}] ✓ RESPONSE OK`, {
        status: response.status,
        statusText: response.statusText,
        duration: `${duration}ms`,
        body: truncateForLog(responseBody),
      });
    } else {
      console.error(`[HOPX:${requestId}] ✗ RESPONSE ERROR`, {
        status: response.status,
        statusText: response.statusText,
        duration: `${duration}ms`,
        body: truncateForLog(responseBody),
      });
    }

    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[HOPX:${requestId}] ✗ FETCH ERROR`, {
      duration: `${duration}ms`,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

// Helper to make authenticated HOPX VM Agent API calls
// Used for: file operations, code execution, commands (sandbox-specific)
async function hopxAgentFetch(
  sandboxId: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiKey = getApiKey();
  const requestId = ++requestCounter;
  const fullUrl = `https://${sandboxId}.hopx.dev${endpoint}`;
  const method = options.method ?? "GET";

  console.log(`[HOPX:${requestId}] ▶ REQUEST to VM Agent`, {
    sandboxId,
    url: fullUrl,
    method,
    hasApiKey: Boolean(apiKey),
    apiKeyPrefix: apiKey ? `${apiKey.substring(0, 8)}...` : null,
    body: options.body ? truncateForLog(String(options.body)) : undefined,
  });

  if (!apiKey) {
    const error = new Error("No HOPX API key provided. Please configure your HOPX API key in the MCP server settings.");
    console.error(`[HOPX:${requestId}] ✗ AUTH ERROR`, { error: error.message });
    throw error;
  }

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Content-Type", "application/json");

  const startTime = Date.now();

  try {
    const response = await fetch(fullUrl, {
      ...options,
      headers,
    });

    const duration = Date.now() - startTime;

    // Clone response to read body without consuming it
    const responseClone = response.clone();
    let responseBody: string;
    try {
      responseBody = await responseClone.text();
    } catch {
      responseBody = "[Could not read response body]";
    }

    if (response.ok) {
      console.log(`[HOPX:${requestId}] ✓ RESPONSE OK`, {
        sandboxId,
        status: response.status,
        statusText: response.statusText,
        duration: `${duration}ms`,
        body: truncateForLog(responseBody),
      });
    } else {
      console.error(`[HOPX:${requestId}] ✗ RESPONSE ERROR`, {
        sandboxId,
        status: response.status,
        statusText: response.statusText,
        duration: `${duration}ms`,
        body: truncateForLog(responseBody),
      });
    }

    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[HOPX:${requestId}] ✗ FETCH ERROR`, {
      sandboxId,
      duration: `${duration}ms`,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

// Tool invocation counter
let toolCounter = 0;

// Helper for standard tool response
function toolResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

// Helper for error responses
function errorResponse(action: string, error: unknown) {
  console.error(`[HOPX TOOL] ✗ Error during ${action}:`, error instanceof Error ? error.message : String(error));
  return toolResponse(`Failed to ${action}: ${error instanceof Error ? error.message : String(error)}`);
}

// Helper to log tool invocation
function logToolCall(toolName: string, args: Record<string, unknown>) {
  const invocationId = ++toolCounter;
  console.log(`[HOPX TOOL:${invocationId}] ▶ INVOKING "${toolName}"`, {
    args: JSON.stringify(args).substring(0, 500),
  });
  return invocationId;
}

// Helper to log tool completion
function logToolComplete(invocationId: number, toolName: string, success: boolean, resultPreview?: string) {
  if (success) {
    console.log(`[HOPX TOOL:${invocationId}] ✓ COMPLETED "${toolName}"`, {
      resultPreview: resultPreview?.substring(0, 200),
    });
  } else {
    console.error(`[HOPX TOOL:${invocationId}] ✗ FAILED "${toolName}"`, {
      resultPreview: resultPreview?.substring(0, 200),
    });
  }
}

// Create the MCP handler with tools
const mcpHandler = createMcpHandler(
  async (server) => {
    // ========== System ==========
    server.registerTool(
      "health",
      {
        title: "health",
        description: "GET /health — Check health status of the HOPX API and verify authentication.",
        inputSchema: z.object({}),
      },
      async () => {
        const invocationId = logToolCall("health", {});
        const apiKey = getApiKey();
        if (!apiKey) {
          logToolComplete(invocationId, "health", false, "No API key");
          return toolResponse("Error: No HOPX API key provided. Please configure your API key in the MCP server settings.");
        }

        try {
          const response = await hopxFetch("/health");
          const data = await response.json();
          const result = `HOPX API Status: ${JSON.stringify(data, null, 2)}\nAuthenticated: Yes (API key: ${apiKey.substring(0, 8)}...)`;
          logToolComplete(invocationId, "health", response.ok, JSON.stringify(data));
          return toolResponse(result);
        } catch (error) {
          logToolComplete(invocationId, "health", false, String(error));
          return errorResponse("check HOPX API health", error);
        }
      }
    );

    // ========== Sandboxes ==========
    server.registerTool(
      "list_sandboxes",
      {
        title: "list_sandboxes",
        description: "GET /v1/sandboxes — List all sandboxes with their current status, configuration, and metadata.",
        inputSchema: z.object({
          limit: z.number().optional().describe("Maximum number of sandboxes to return (default: 100)"),
          status: z.string().optional().describe("Filter by status: 'running', 'stopped', 'paused', or 'creating'"),
          region: z.string().optional().describe("Filter by region (e.g., 'us-east', 'eu-west')"),
        }),
      },
      async ({ limit, status, region }) => {
        const invocationId = logToolCall("list_sandboxes", { limit, status, region });
        try {
          const params = new URLSearchParams();
          if (limit) params.set("limit", String(limit));
          if (status) params.set("status", status);
          if (region) params.set("region", region);

          const response = await hopxFetch(`/v1/sandboxes?${params.toString()}`);
          const data = await response.json();

          if (!response.ok) {
            logToolComplete(invocationId, "list_sandboxes", false, JSON.stringify(data));
            return toolResponse(`Error listing sandboxes: ${JSON.stringify(data)}`);
          }

          logToolComplete(invocationId, "list_sandboxes", true, JSON.stringify(data));
          return toolResponse(JSON.stringify(data, null, 2));
        } catch (error) {
          logToolComplete(invocationId, "list_sandboxes", false, String(error));
          return errorResponse("list sandboxes", error);
        }
      }
    );

    server.registerTool(
      "create_sandbox",
      {
        title: "create_sandbox",
        description: "POST /v1/sandboxes — Create a new sandbox. First use list_templates() to find available templates.",
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
              template_id,
              region,
              timeout_seconds: timeout_seconds ?? 600,
              internet_access: internet_access ?? true,
              env_vars,
            }),
          });

          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error creating sandbox: ${JSON.stringify(data)}`);
          }

          return toolResponse(`Sandbox created successfully:\n${JSON.stringify(data, null, 2)}`);
        } catch (error) {
          return errorResponse("create sandbox", error);
        }
      }
    );

    server.registerTool(
      "get_sandbox",
      {
        title: "get_sandbox",
        description: "GET /v1/sandboxes/{id} — Get detailed sandbox information including status, resource usage, and connection info.",
        inputSchema: z.object({
          id: z.string().describe("Sandbox ID"),
        }),
      },
      async ({ id }) => {
        try {
          const response = await hopxFetch(`/v1/sandboxes/${id}`);
          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error getting sandbox: ${JSON.stringify(data)}`);
          }

          return toolResponse(JSON.stringify(data, null, 2));
        } catch (error) {
          return errorResponse("get sandbox", error);
        }
      }
    );

    server.registerTool(
      "delete_sandbox",
      {
        title: "delete_sandbox",
        description: "DELETE /v1/sandboxes/{id} — Permanently delete a sandbox.",
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
            return toolResponse(`Error deleting sandbox: ${JSON.stringify(data)}`);
          }

          return toolResponse(`Sandbox ${id} deleted successfully.`);
        } catch (error) {
          return errorResponse("delete sandbox", error);
        }
      }
    );

    server.registerTool(
      "update_sandbox_timeout",
      {
        title: "update_sandbox_timeout",
        description: "PUT /v1/sandboxes/{id}/timeout — Extend or modify sandbox timeout.",
        inputSchema: z.object({
          id: z.string().describe("Sandbox ID"),
          timeout_seconds: z.number().describe("New timeout in seconds"),
        }),
      },
      async ({ id, timeout_seconds }) => {
        try {
          const response = await hopxFetch(`/v1/sandboxes/${id}/timeout`, {
            method: "PUT",
            body: JSON.stringify({ timeout_seconds }),
          });

          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error updating timeout: ${JSON.stringify(data)}`);
          }

          return toolResponse(`Sandbox ${id} timeout updated to ${timeout_seconds} seconds.`);
        } catch (error) {
          return errorResponse("update sandbox timeout", error);
        }
      }
    );

    server.registerTool(
      "resume_sandbox",
      {
        title: "resume_sandbox",
        description: "POST /v1/sandboxes/{id}/resume — Resume a paused sandbox.",
        inputSchema: z.object({
          id: z.string().describe("Sandbox ID to resume"),
        }),
      },
      async ({ id }) => {
        try {
          const response = await hopxFetch(`/v1/sandboxes/${id}/resume`, {
            method: "POST",
          });

          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error resuming sandbox: ${JSON.stringify(data)}`);
          }

          return toolResponse(`Sandbox ${id} resumed successfully.`);
        } catch (error) {
          return errorResponse("resume sandbox", error);
        }
      }
    );

    // ========== Templates ==========
    server.registerTool(
      "list_templates",
      {
        title: "list_templates",
        description: "GET /v1/templates — List available sandbox templates. Templates are pre-configured environments (Python, Node.js, Ubuntu).",
        inputSchema: z.object({
          limit: z.number().optional().describe("Maximum number of templates to return (default: 10)"),
          fields: z.string().optional().describe("Comma-separated fields to return (default: 'id,name,description,category,language')"),
        }),
      },
      async ({ limit, fields }) => {
        try {
          const params = new URLSearchParams();
          if (limit) params.set("limit", String(limit));
          if (fields) params.set("fields", fields);

          const response = await hopxFetch(`/v1/templates?${params.toString()}`);
          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error listing templates: ${JSON.stringify(data)}`);
          }

          return toolResponse(JSON.stringify(data, null, 2));
        } catch (error) {
          return errorResponse("list templates", error);
        }
      }
    );

    server.registerTool(
      "get_template",
      {
        title: "get_template",
        description: "GET /v1/templates/{name} — Get detailed template information including configuration and available regions.",
        inputSchema: z.object({
          name: z.string().describe("Template name"),
        }),
      },
      async ({ name }) => {
        try {
          const response = await hopxFetch(`/v1/templates/${encodeURIComponent(name)}`);
          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error getting template: ${JSON.stringify(data)}`);
          }

          return toolResponse(JSON.stringify(data, null, 2));
        } catch (error) {
          return errorResponse("get template", error);
        }
      }
    );

    // ========== Code Execution ==========
    server.registerTool(
      "execute_code",
      {
        title: "execute_code",
        description: "Execute code in a HOPX sandbox. Supports Python, JavaScript, Bash, and Go. Use mode='isolated' for quick one-shot scripts.",
        inputSchema: z.object({
          sandbox_id: z.string().optional().describe("Sandbox ID (required for persistent/rich/background modes, optional for isolated)"),
          code: z.string().describe("Code to execute"),
          mode: z.enum(["isolated", "persistent", "rich", "background"]).optional().describe("Execution mode (default: isolated)"),
          language: z.enum(["python", "javascript", "bash", "go"]).optional().describe("Programming language (default: python)"),
          timeout: z.number().optional().describe("Execution timeout in seconds (default: 30)"),
          env: z.record(z.string()).optional().describe("Environment variables for execution"),
          working_dir: z.string().optional().describe("Working directory"),
          name: z.string().optional().describe("Process name (background mode only)"),
          template_name: z.string().optional().describe("Template to use (isolated mode only, default: code-interpreter)"),
          region: z.string().optional().describe("Deployment region (isolated mode only)"),
        }),
      },
      async ({ sandbox_id, code, mode, language, timeout, env, working_dir, name, template_name, region }) => {
        const execMode = mode ?? "isolated";

        try {
          if (execMode === "isolated") {
            // Create ephemeral sandbox and execute
            const response = await hopxFetch("/v1/execute/isolated", {
              method: "POST",
              body: JSON.stringify({
                code,
                language: language ?? "python",
                timeout: timeout ?? 30,
                env,
                template: template_name ?? "code-interpreter",
                region,
              }),
            });

            const data = await response.json();

            if (!response.ok) {
              return toolResponse(`Error executing code (isolated): ${JSON.stringify(data)}`);
            }

            return toolResponse(`Execution result:\n${JSON.stringify(data, null, 2)}`);
          } else {
            // Execute in existing sandbox via VM Agent
            if (!sandbox_id) {
              return toolResponse("Error: sandbox_id is required for persistent/rich/background modes");
            }

            const endpoint = execMode === "background"
              ? `/execute/background`
              : `/execute`;

            const response = await hopxAgentFetch(sandbox_id, endpoint, {
              method: "POST",
              body: JSON.stringify({
                code,
                language: language ?? "python",
                timeout: timeout ?? 30,
                env,
                working_dir,
                name,
                rich: execMode === "rich",
              }),
            });

            const data = await response.json();

            if (!response.ok) {
              return toolResponse(`Error executing code (${execMode}): ${JSON.stringify(data)}`);
            }

            return toolResponse(`Execution result:\n${JSON.stringify(data, null, 2)}`);
          }
        } catch (error) {
          return errorResponse("execute code", error);
        }
      }
    );

    server.registerTool(
      "execute_code_isolated",
      {
        title: "execute_code_isolated",
        description: "Fast isolated code execution — Create ephemeral sandbox, execute code, return output. Best for quick one-shot scripts.",
        inputSchema: z.object({
          code: z.string().describe("Code to execute"),
          language: z.enum(["python", "javascript", "bash", "go"]).optional().describe("Programming language (default: python)"),
          timeout: z.number().optional().describe("Execution timeout in seconds (default: 30)"),
          env: z.record(z.string()).optional().describe("Environment variables"),
          template_name: z.string().optional().describe("Template name (default: code-interpreter)"),
          region: z.string().optional().describe("Region (e.g., 'us-east', 'eu-west')"),
        }),
      },
      async ({ code, language, timeout, env, template_name, region }) => {
        const invocationId = logToolCall("execute_code_isolated", { language, timeout, template_name, region, codeLength: code.length });
        try {
          const response = await hopxFetch("/v1/execute/isolated", {
            method: "POST",
            body: JSON.stringify({
              code,
              language: language ?? "python",
              timeout: timeout ?? 30,
              env,
              template: template_name ?? "code-interpreter",
              region,
            }),
          });

          const data = await response.json();

          if (!response.ok) {
            logToolComplete(invocationId, "execute_code_isolated", false, JSON.stringify(data));
            return toolResponse(`Error executing code: ${JSON.stringify(data)}`);
          }

          logToolComplete(invocationId, "execute_code_isolated", true, JSON.stringify(data));
          return toolResponse(`Execution result:\n${JSON.stringify(data, null, 2)}`);
        } catch (error) {
          logToolComplete(invocationId, "execute_code_isolated", false, String(error));
          return errorResponse("execute code (isolated)", error);
        }
      }
    );

    server.registerTool(
      "execute_list_processes",
      {
        title: "execute_list_processes",
        description: "GET /execute/processes — List background processes with their status.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
          max_results: z.number().optional().describe("Maximum processes to return (default: 100)"),
        }),
      },
      async ({ sandbox_id, max_results }) => {
        try {
          const params = new URLSearchParams();
          if (max_results) params.set("max_results", String(max_results));

          const response = await hopxAgentFetch(sandbox_id, `/execute/processes?${params.toString()}`);
          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error listing processes: ${JSON.stringify(data)}`);
          }

          return toolResponse(JSON.stringify(data, null, 2));
        } catch (error) {
          return errorResponse("list processes", error);
        }
      }
    );

    server.registerTool(
      "execute_kill_process",
      {
        title: "execute_kill_process",
        description: "DELETE /execute/kill — Kill a background process.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
          process_id: z.string().describe("Process ID from execute_code_background()"),
        }),
      },
      async ({ sandbox_id, process_id }) => {
        try {
          const response = await hopxAgentFetch(sandbox_id, `/execute/kill?process_id=${encodeURIComponent(process_id)}`, {
            method: "DELETE",
          });

          if (!response.ok) {
            const data = await response.json();
            return toolResponse(`Error killing process: ${JSON.stringify(data)}`);
          }

          return toolResponse(`Process ${process_id} killed successfully.`);
        } catch (error) {
          return errorResponse("kill process", error);
        }
      }
    );

    // ========== Commands ==========
    server.registerTool(
      "run_command",
      {
        title: "run_command",
        description: "POST /commands/run — Run a shell command in sandbox and wait for completion.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
          command: z.string().describe("Shell command to execute"),
          timeout: z.number().optional().describe("Command timeout in seconds (default: 30)"),
          working_dir: z.string().optional().describe("Working directory (default: /workspace)"),
          env: z.record(z.string()).optional().describe("Environment variables"),
        }),
      },
      async ({ sandbox_id, command, timeout, working_dir, env }) => {
        try {
          const response = await hopxAgentFetch(sandbox_id, `/commands/run`, {
            method: "POST",
            body: JSON.stringify({
              command,
              timeout: timeout ?? 30,
              working_dir: working_dir ?? "/workspace",
              env,
            }),
          });

          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error running command: ${JSON.stringify(data)}`);
          }

          return toolResponse(`Command result:\n${JSON.stringify(data, null, 2)}`);
        } catch (error) {
          return errorResponse("run command", error);
        }
      }
    );

    server.registerTool(
      "run_command_background",
      {
        title: "run_command_background",
        description: "POST /commands/background — Run shell command in background and return immediately.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
          command: z.string().describe("Shell command to execute"),
          timeout: z.number().optional().describe("Max execution time in seconds (default: 300)"),
          working_dir: z.string().optional().describe("Working directory"),
          env: z.record(z.string()).optional().describe("Environment variables"),
          name: z.string().optional().describe("Process name for identification"),
        }),
      },
      async ({ sandbox_id, command, timeout, working_dir, env, name }) => {
        try {
          const response = await hopxAgentFetch(sandbox_id, `/commands/background`, {
            method: "POST",
            body: JSON.stringify({
              command,
              timeout: timeout ?? 300,
              working_dir,
              env,
              name,
            }),
          });

          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error running background command: ${JSON.stringify(data)}`);
          }

          return toolResponse(`Background command started:\n${JSON.stringify(data, null, 2)}`);
        } catch (error) {
          return errorResponse("run background command", error);
        }
      }
    );

    server.registerTool(
      "list_processes",
      {
        title: "list_processes",
        description: "GET /processes — List all system processes in the sandbox.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
          max_results: z.number().optional().describe("Maximum processes to return (default: 200)"),
        }),
      },
      async ({ sandbox_id, max_results }) => {
        try {
          const params = new URLSearchParams();
          if (max_results) params.set("max_results", String(max_results));

          const response = await hopxAgentFetch(sandbox_id, `/system/processes?${params.toString()}`);
          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error listing system processes: ${JSON.stringify(data)}`);
          }

          return toolResponse(JSON.stringify(data, null, 2));
        } catch (error) {
          return errorResponse("list system processes", error);
        }
      }
    );

    // ========== File Operations ==========
    server.registerTool(
      "file_read",
      {
        title: "file_read",
        description: "GET /files/read — Read file contents from sandbox.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
          path: z.string().describe("File path to read (e.g., '/workspace/script.py')"),
        }),
      },
      async ({ sandbox_id, path }) => {
        try {
          const response = await hopxAgentFetch(sandbox_id, `/files/read?path=${encodeURIComponent(path)}`);
          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error reading file: ${JSON.stringify(data)}`);
          }

          return toolResponse(typeof data.content === "string" ? data.content : JSON.stringify(data, null, 2));
        } catch (error) {
          return errorResponse("read file", error);
        }
      }
    );

    server.registerTool(
      "file_write",
      {
        title: "file_write",
        description: "POST /files/write — Write file to sandbox (creates or overwrites).",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
          path: z.string().describe("Destination file path"),
          content: z.string().describe("File content to write"),
        }),
      },
      async ({ sandbox_id, path, content }) => {
        try {
          const response = await hopxAgentFetch(sandbox_id, `/files/write`, {
            method: "POST",
            body: JSON.stringify({ path, content }),
          });

          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error writing file: ${JSON.stringify(data)}`);
          }

          return toolResponse(`File written successfully: ${path}`);
        } catch (error) {
          return errorResponse("write file", error);
        }
      }
    );

    server.registerTool(
      "file_list",
      {
        title: "file_list",
        description: "GET /files/list — List directory contents in sandbox.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
          path: z.string().optional().describe("Directory path to list (default: /workspace)"),
          max_results: z.number().optional().describe("Maximum files to return (default: 1000)"),
        }),
      },
      async ({ sandbox_id, path, max_results }) => {
        try {
          const dirPath = path ?? "/workspace";
          const params = new URLSearchParams();
          params.set("path", dirPath);
          if (max_results) params.set("max_results", String(max_results));

          const response = await hopxAgentFetch(sandbox_id, `/files/list?${params.toString()}`);
          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error listing files: ${JSON.stringify(data)}`);
          }

          return toolResponse(JSON.stringify(data, null, 2));
        } catch (error) {
          return errorResponse("list files", error);
        }
      }
    );

    server.registerTool(
      "file_exists",
      {
        title: "file_exists",
        description: "GET /files/exists — Check if file or directory exists.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
          path: z.string().describe("Path to check"),
        }),
      },
      async ({ sandbox_id, path }) => {
        try {
          const response = await hopxAgentFetch(sandbox_id, `/files/exists?path=${encodeURIComponent(path)}`);
          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error checking file existence: ${JSON.stringify(data)}`);
          }

          return toolResponse(JSON.stringify(data, null, 2));
        } catch (error) {
          return errorResponse("check file existence", error);
        }
      }
    );

    server.registerTool(
      "file_remove",
      {
        title: "file_remove",
        description: "DELETE /files/remove — Delete file or directory from sandbox.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
          path: z.string().describe("Path to delete"),
        }),
      },
      async ({ sandbox_id, path }) => {
        try {
          const response = await hopxAgentFetch(sandbox_id, `/files/remove`, {
            method: "DELETE",
            body: JSON.stringify({ path }),
          });

          if (!response.ok) {
            const data = await response.json();
            return toolResponse(`Error removing file: ${JSON.stringify(data)}`);
          }

          return toolResponse(`File removed successfully: ${path}`);
        } catch (error) {
          return errorResponse("remove file", error);
        }
      }
    );

    server.registerTool(
      "file_mkdir",
      {
        title: "file_mkdir",
        description: "POST /files/mkdir — Create directory in sandbox (creates parent directories if needed).",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
          path: z.string().describe("Directory path to create"),
        }),
      },
      async ({ sandbox_id, path }) => {
        try {
          const response = await hopxAgentFetch(sandbox_id, `/files/mkdir`, {
            method: "POST",
            body: JSON.stringify({ path }),
          });

          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error creating directory: ${JSON.stringify(data)}`);
          }

          return toolResponse(`Directory created successfully: ${path}`);
        } catch (error) {
          return errorResponse("create directory", error);
        }
      }
    );

    // ========== VM Agent Interactions ==========
    server.registerTool(
      "ping_vm",
      {
        title: "ping_vm",
        description: "Quick VM liveness check. Returns immediately to verify VM is responsive.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
        }),
      },
      async ({ sandbox_id }) => {
        try {
          const response = await hopxAgentFetch(sandbox_id, `/ping`);
          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error pinging VM: ${JSON.stringify(data)}`);
          }

          return toolResponse(`VM is alive: ${JSON.stringify(data, null, 2)}`);
        } catch (error) {
          return errorResponse("ping VM", error);
        }
      }
    );

    server.registerTool(
      "get_vm_info",
      {
        title: "get_vm_info",
        description: "GET /info — Get VM agent information and capabilities.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
        }),
      },
      async ({ sandbox_id }) => {
        try {
          const response = await hopxAgentFetch(sandbox_id, `/info`);
          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error getting VM info: ${JSON.stringify(data)}`);
          }

          return toolResponse(JSON.stringify(data, null, 2));
        } catch (error) {
          return errorResponse("get VM info", error);
        }
      }
    );

    server.registerTool(
      "get_preview_url",
      {
        title: "get_preview_url",
        description: "Get public preview URL for a service running in the sandbox on a specific port.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
          port: z.number().describe("Port number where service is listening"),
        }),
      },
      async ({ sandbox_id, port }) => {
        try {
          // Preview URL is a control plane operation
          const response = await hopxFetch(`/v1/sandboxes/${sandbox_id}/preview?port=${port}`);
          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error getting preview URL: ${JSON.stringify(data)}`);
          }

          return toolResponse(`Preview URL: ${JSON.stringify(data, null, 2)}\n\nNote: Service must bind to 0.0.0.0 (not localhost) to be accessible.`);
        } catch (error) {
          return errorResponse("get preview URL", error);
        }
      }
    );

    server.registerTool(
      "get_agent_url",
      {
        title: "get_agent_url",
        description: "Get the agent URL for the sandbox (default port 7777).",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
        }),
      },
      async ({ sandbox_id }) => {
        try {
          // Return the computed agent URL directly
          return toolResponse(`Agent URL: https://${sandbox_id}.hopx.dev`);
        } catch (error) {
          return errorResponse("get agent URL", error);
        }
      }
    );

    // ========== System Metrics ==========
    server.registerTool(
      "get_system_metrics",
      {
        title: "get_system_metrics",
        description: "GET /system — Get sandbox system metrics (CPU, memory, disk usage).",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
        }),
      },
      async ({ sandbox_id }) => {
        try {
          const response = await hopxAgentFetch(sandbox_id, `/system`);
          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error getting system metrics: ${JSON.stringify(data)}`);
          }

          return toolResponse(JSON.stringify(data, null, 2));
        } catch (error) {
          return errorResponse("get system metrics", error);
        }
      }
    );

    // ========== Environment Variables ==========
    server.registerTool(
      "env_get",
      {
        title: "env_get",
        description: "GET /env — Get all global environment variables (sensitive values masked).",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
        }),
      },
      async ({ sandbox_id }) => {
        try {
          const response = await hopxAgentFetch(sandbox_id, `/env`);
          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error getting environment variables: ${JSON.stringify(data)}`);
          }

          return toolResponse(JSON.stringify(data, null, 2));
        } catch (error) {
          return errorResponse("get environment variables", error);
        }
      }
    );

    server.registerTool(
      "env_set",
      {
        title: "env_set",
        description: "PUT/PATCH /env — Set or merge environment variables.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
          env_vars: z.record(z.string()).describe("Dictionary of environment variables to set"),
          merge: z.boolean().optional().describe("If true, merge with existing vars (default: true)"),
        }),
      },
      async ({ sandbox_id, env_vars, merge }) => {
        try {
          const method = merge !== false ? "PATCH" : "PUT";
          const response = await hopxAgentFetch(sandbox_id, `/env`, {
            method,
            body: JSON.stringify(env_vars),
          });

          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error setting environment variables: ${JSON.stringify(data)}`);
          }

          return toolResponse(`Environment variables ${merge !== false ? "merged" : "set"} successfully.`);
        } catch (error) {
          return errorResponse("set environment variables", error);
        }
      }
    );

    server.registerTool(
      "env_clear",
      {
        title: "env_clear",
        description: "DELETE /env — Clear all global environment variables.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
        }),
      },
      async ({ sandbox_id }) => {
        try {
          const response = await hopxAgentFetch(sandbox_id, `/env`, {
            method: "DELETE",
          });

          if (!response.ok) {
            const data = await response.json();
            return toolResponse(`Error clearing environment variables: ${JSON.stringify(data)}`);
          }

          return toolResponse("Environment variables cleared successfully.");
        } catch (error) {
          return errorResponse("clear environment variables", error);
        }
      }
    );

    // ========== Cache ==========
    server.registerTool(
      "cache_clear",
      {
        title: "cache_clear",
        description: "POST /cache/clear — Clear execution cache to free memory or force re-execution.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
        }),
      },
      async ({ sandbox_id }) => {
        try {
          const response = await hopxAgentFetch(sandbox_id, `/cache/clear`, {
            method: "POST",
          });

          if (!response.ok) {
            const data = await response.json();
            return toolResponse(`Error clearing cache: ${JSON.stringify(data)}`);
          }

          return toolResponse("Cache cleared successfully.");
        } catch (error) {
          return errorResponse("clear cache", error);
        }
      }
    );

    server.registerTool(
      "cache_stats",
      {
        title: "cache_stats",
        description: "GET /cache/stats — Get execution cache statistics.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
        }),
      },
      async ({ sandbox_id }) => {
        try {
          const response = await hopxAgentFetch(sandbox_id, `/cache/stats`);
          const data = await response.json();

          if (!response.ok) {
            return toolResponse(`Error getting cache stats: ${JSON.stringify(data)}`);
          }

          return toolResponse(JSON.stringify(data, null, 2));
        } catch (error) {
          return errorResponse("get cache stats", error);
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
