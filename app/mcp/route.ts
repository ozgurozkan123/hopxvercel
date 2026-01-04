import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

// HOPX MCP Server - Converted for Vercel deployment
// Note: This server provides the MCP interface for HOPX sandbox API.
// Actual code execution requires a HOPX API key set as environment variable.

const handler = createMcpHandler(
  async (server) => {
    // ---------- System ----------
    server.registerTool(
      "health",
      {
        title: "health",
        description: "GET /health — public health check. Returns health status of the HOPX API.",
        inputSchema: z.object({}),
      },
      async () => ({
        content: [{ type: "text", text: "HOPX MCP server is running. Note: This is a serverless deployment. Use with HOPX API key for actual sandbox operations." }],
      })
    );

    // ---------- Sandboxes ----------
    server.registerTool(
      "list_sandboxes",
      {
        title: "list_sandboxes",
        description: "GET /v1/sandboxes — list all sandboxes. Returns a list of sandboxes with their current status, configuration, and metadata.",
        inputSchema: z.object({
          limit: z.number().optional().describe("Maximum number of sandboxes to return (default: 100)"),
          status: z.string().optional().describe("Filter by status: 'running', 'stopped', 'paused', or 'creating'"),
          region: z.string().optional().describe("Filter by region (e.g., 'us-east', 'eu-west')"),
        }),
      },
      async ({ limit, status, region }) => ({
        content: [{ type: "text", text: `To list sandboxes, use HOPX SDK: Sandbox.list(status="${status || ''}", region="${region || ''}", limit=${limit || 100}). This requires the hopx-ai Python SDK and HOPX_API_KEY environment variable.` }],
      })
    );

    server.registerTool(
      "create_sandbox",
      {
        title: "create_sandbox",
        description: "POST /v1/sandboxes — create a new sandbox. First use list_templates() to find available templates, then create a sandbox with the template's id or name.",
        inputSchema: z.object({
          template_id: z.string().describe("Template ID or name (e.g., 'code-interpreter')"),
          region: z.string().optional().describe("Deployment region, e.g., 'us-east', 'eu-west'"),
          timeout_seconds: z.number().optional().describe("Auto-shutdown timeout in seconds (e.g., 3600 for 1 hour)"),
          internet_access: z.boolean().optional().describe("Enable internet access"),
          env_vars: z.record(z.string()).optional().describe("Initial environment variables"),
        }),
      },
      async ({ template_id, region, timeout_seconds, internet_access, env_vars }) => ({
        content: [{ type: "text", text: `To create sandbox, use HOPX SDK:\nSandbox.create(template="${template_id}", region="${region || ''}", timeout_seconds=${timeout_seconds || 600}, internet_access=${internet_access ?? true}, env_vars=${JSON.stringify(env_vars || {})})\n\nThis requires hopx-ai SDK and HOPX_API_KEY.` }],
      })
    );

    server.registerTool(
      "get_sandbox",
      {
        title: "get_sandbox",
        description: "GET /v1/sandboxes/{id} — get detailed sandbox information including status, resource usage, and connection info.",
        inputSchema: z.object({
          id: z.string().describe("Sandbox ID"),
        }),
      },
      async ({ id }) => ({
        content: [{ type: "text", text: `To get sandbox info, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${id}")\ninfo = sandbox.get_info()` }],
      })
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
      async ({ id }) => ({
        content: [{ type: "text", text: `To delete sandbox, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${id}")\nsandbox.kill()` }],
      })
    );

    server.registerTool(
      "update_sandbox_timeout",
      {
        title: "update_sandbox_timeout",
        description: "PUT /v1/sandboxes/{id}/timeout — extend or modify sandbox timeout.",
        inputSchema: z.object({
          id: z.string().describe("Sandbox ID"),
          timeout_seconds: z.number().describe("New timeout in seconds"),
        }),
      },
      async ({ id, timeout_seconds }) => ({
        content: [{ type: "text", text: `To update timeout, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${id}")\nsandbox.set_timeout(${timeout_seconds})` }],
      })
    );

    server.registerTool(
      "resume_sandbox",
      {
        title: "resume_sandbox",
        description: "POST /v1/sandboxes/{id}/resume — resume a paused sandbox.",
        inputSchema: z.object({
          id: z.string().describe("Sandbox ID to resume"),
        }),
      },
      async ({ id }) => ({
        content: [{ type: "text", text: `To resume sandbox, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${id}")\nsandbox.resume()` }],
      })
    );

    // ---------- Templates ----------
    server.registerTool(
      "list_templates",
      {
        title: "list_templates",
        description: "GET /v1/templates — list available sandbox templates. Templates are pre-configured environments (Python, Node.js, Ubuntu) that define the base system.",
        inputSchema: z.object({
          limit: z.number().optional().describe("Maximum number of templates to return (default: 10)"),
          fields: z.string().optional().describe("Comma-separated fields to return (default: 'id,name,description,category,language')"),
        }),
      },
      async ({ limit, fields }) => ({
        content: [{ type: "text", text: `To list templates, use HOPX SDK:\ntemplates = Sandbox.list_templates()\nCommon templates: 'code-interpreter', 'ubuntu', 'nodejs'\n\nLimit: ${limit || 10}, Fields: ${fields || 'id,name,description,category,language'}` }],
      })
    );

    server.registerTool(
      "get_template",
      {
        title: "get_template",
        description: "GET /v1/templates/{name} — get detailed template information including configuration and available regions.",
        inputSchema: z.object({
          name: z.string().describe("Template name"),
        }),
      },
      async ({ name }) => ({
        content: [{ type: "text", text: `To get template info, use HOPX SDK:\ntemplate = Sandbox.get_template(name="${name}")` }],
      })
    );

    // ---------- Code Execution ----------
    server.registerTool(
      "execute_code",
      {
        title: "execute_code",
        description: "Unified code execution API with 4 modes: isolated (one-shot), persistent (existing sandbox), rich (capture plots/dataframes), background (non-blocking). Use mode='isolated' for quick scripts.",
        inputSchema: z.object({
          code: z.string().describe("Code to execute"),
          mode: z.enum(["isolated", "persistent", "rich", "background"]).optional().describe("Execution mode (default: isolated)"),
          sandbox_id: z.string().optional().describe("Sandbox ID (required for persistent/rich/background modes)"),
          language: z.enum(["python", "javascript", "bash", "go"]).optional().describe("Programming language (default: python)"),
          timeout: z.number().optional().describe("Execution timeout in seconds (default: 30)"),
          env: z.record(z.string()).optional().describe("Environment variables for execution"),
          working_dir: z.string().optional().describe("Working directory (persistent/rich/background only)"),
          name: z.string().optional().describe("Process name (background mode only)"),
          template_name: z.string().optional().describe("Template to use (isolated mode only, default: code-interpreter)"),
          region: z.string().optional().describe("Deployment region (isolated mode only)"),
        }),
      },
      async ({ code, mode, sandbox_id, language, timeout, env, working_dir, name, template_name, region }) => {
        const m = mode || "isolated";
        const lang = language || "python";
        const t = timeout || 30;
        
        let sdk_call = "";
        if (m === "isolated") {
          sdk_call = `# Isolated mode - one-shot execution
with Sandbox.create(template="${template_name || 'code-interpreter'}", region="${region || ''}", timeout_seconds=600) as sandbox:
    result = sandbox.run_code(code='''${code}''', language="${lang}", timeout=${t}, env=${JSON.stringify(env || {})})`;
        } else if (m === "persistent") {
          sdk_call = `# Persistent mode - execute in existing sandbox
sandbox = Sandbox.connect(sandbox_id="${sandbox_id}")
result = sandbox.run_code(code='''${code}''', language="${lang}", timeout=${t}, env=${JSON.stringify(env || {})}, working_dir="${working_dir || '/tmp'}")`;
        } else if (m === "rich") {
          sdk_call = `# Rich mode - capture matplotlib plots, DataFrames
sandbox = Sandbox.connect(sandbox_id="${sandbox_id}")
result = sandbox.run_code(code='''${code}''', language="${lang}", timeout=${t}, env=${JSON.stringify(env || {})}, working_dir="${working_dir || '/tmp'}")
# Access rich_outputs: result.rich_outputs`;
        } else if (m === "background") {
          sdk_call = `# Background mode - non-blocking execution
sandbox = Sandbox.connect(sandbox_id="${sandbox_id}")
result = sandbox.run_code_background(code='''${code}''', language="${lang}", timeout=${t}, env=${JSON.stringify(env || {})}, working_dir="${working_dir || ''}", name="${name || ''}")`;
        }
        
        return {
          content: [{ type: "text", text: `To execute code with HOPX SDK:\n\n${sdk_call}\n\nRequires: hopx-ai SDK and HOPX_API_KEY` }],
        };
      }
    );

    server.registerTool(
      "execute_code_isolated",
      {
        title: "execute_code_isolated",
        description: "Fast isolated code execution - Create ephemeral sandbox, execute code, return output. DEPRECATED: Use execute_code(mode='isolated') instead.",
        inputSchema: z.object({
          code: z.string().describe("Code to execute"),
          language: z.enum(["python", "javascript", "bash", "go"]).optional().describe("Programming language (default: python)"),
          timeout: z.number().optional().describe("Execution timeout in seconds (default: 30)"),
          env: z.record(z.string()).optional().describe("Environment variables"),
          template_name: z.string().optional().describe("Template name (default: code-interpreter)"),
          region: z.string().optional().describe("Region (e.g., 'us-east', 'eu-west')"),
        }),
      },
      async ({ code, language, timeout, env, template_name, region }) => ({
        content: [{ type: "text", text: `DEPRECATED: Use execute_code(mode='isolated') instead.\n\nSDK call:\nwith Sandbox.create(template="${template_name || 'code-interpreter'}", region="${region || ''}") as sandbox:\n    result = sandbox.run_code(code='''${code}''', language="${language || 'python'}", timeout=${timeout || 30})` }],
      })
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
      async ({ sandbox_id, max_results }) => ({
        content: [{ type: "text", text: `To list processes, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\nprocesses = sandbox.list_processes()\n\nMax results: ${max_results || 100}` }],
      })
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
      async ({ sandbox_id, process_id }) => ({
        content: [{ type: "text", text: `To kill process, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\nsandbox.kill_process("${process_id}")` }],
      })
    );

    // ---------- Commands ----------
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
      async ({ sandbox_id, command, timeout, working_dir, env }) => ({
        content: [{ type: "text", text: `To run command, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\nresult = sandbox.commands.run(command="${command}", timeout=${timeout || 30}, working_dir="${working_dir || '/workspace'}", env=${JSON.stringify(env || {})})` }],
      })
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
      async ({ sandbox_id, command, timeout, working_dir, env, name }) => ({
        content: [{ type: "text", text: `To run background command, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\nresult = sandbox.commands.run(command="${command}", timeout=${timeout || 300}, working_dir="${working_dir || '/workspace'}", env=${JSON.stringify(env || {})}, background=True)` }],
      })
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
      async ({ sandbox_id, max_results }) => ({
        content: [{ type: "text", text: `To list system processes, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\nprocesses = sandbox.list_system_processes()\n\nMax results: ${max_results || 200}` }],
      })
    );

    // ---------- File Operations ----------
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
      async ({ sandbox_id, path }) => ({
        content: [{ type: "text", text: `To read file, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\ncontent = sandbox.files.read("${path}")` }],
      })
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
      async ({ sandbox_id, path, content }) => ({
        content: [{ type: "text", text: `To write file, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\nsandbox.files.write("${path}", '''${content}''')` }],
      })
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
      async ({ sandbox_id, path, max_results }) => ({
        content: [{ type: "text", text: `To list files, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\nfiles = sandbox.files.list("${path || '/workspace'}")\n\nMax results: ${max_results || 1000}` }],
      })
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
      async ({ sandbox_id, path }) => ({
        content: [{ type: "text", text: `To check file existence, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\nexists = sandbox.files.exists("${path}")` }],
      })
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
      async ({ sandbox_id, path }) => ({
        content: [{ type: "text", text: `To remove file, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\nsandbox.files.remove("${path}")` }],
      })
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
      async ({ sandbox_id, path }) => ({
        content: [{ type: "text", text: `To create directory, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\nsandbox.files.mkdir("${path}")` }],
      })
    );

    // ---------- VM Agent Interactions ----------
    server.registerTool(
      "ping_vm",
      {
        title: "ping_vm",
        description: "Quick VM liveness check. Returns immediately to verify VM is responsive.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
        }),
      },
      async ({ sandbox_id }) => ({
        content: [{ type: "text", text: `To ping VM, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\ninfo = sandbox.get_agent_info()` }],
      })
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
      async ({ sandbox_id }) => ({
        content: [{ type: "text", text: `To get VM info, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\ninfo = sandbox.get_agent_info()` }],
      })
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
      async ({ sandbox_id, port }) => ({
        content: [{ type: "text", text: `To get preview URL, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\npreview_url = sandbox.get_preview_url(${port})\n\nNote: Service must bind to 0.0.0.0 (not localhost) to be accessible.` }],
      })
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
      async ({ sandbox_id }) => ({
        content: [{ type: "text", text: `To get agent URL, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\nagent_url = sandbox.agent_url` }],
      })
    );

    // ---------- System Metrics ----------
    server.registerTool(
      "get_system_metrics",
      {
        title: "get_system_metrics",
        description: "GET /system — Get sandbox system metrics (CPU, memory, disk usage).",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
        }),
      },
      async ({ sandbox_id }) => ({
        content: [{ type: "text", text: `To get system metrics, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\nmetrics = sandbox.get_metrics_snapshot()` }],
      })
    );

    // ---------- Environment Variables ----------
    server.registerTool(
      "env_get",
      {
        title: "env_get",
        description: "GET /env — Get all global environment variables (sensitive values masked).",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
        }),
      },
      async ({ sandbox_id }) => ({
        content: [{ type: "text", text: `To get environment variables, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\nenv_vars = sandbox.env.get_all()` }],
      })
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
      async ({ sandbox_id, env_vars, merge }) => ({
        content: [{ type: "text", text: `To set environment variables, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\n${merge !== false ? `sandbox.env.update(${JSON.stringify(env_vars)})` : `sandbox.env.set_all(${JSON.stringify(env_vars)})`}` }],
      })
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
      async ({ sandbox_id }) => ({
        content: [{ type: "text", text: `To clear environment variables, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\nsandbox.env.set_all({})` }],
      })
    );

    // ---------- Cache ----------
    server.registerTool(
      "cache_clear",
      {
        title: "cache_clear",
        description: "POST /cache/clear — Clear execution cache to free memory or force re-execution.",
        inputSchema: z.object({
          sandbox_id: z.string().describe("Sandbox ID"),
        }),
      },
      async ({ sandbox_id }) => ({
        content: [{ type: "text", text: `To clear cache, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\nsandbox.cache.clear()` }],
      })
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
      async ({ sandbox_id }) => ({
        content: [{ type: "text", text: `To get cache stats, use HOPX SDK:\nsandbox = Sandbox.connect(sandbox_id="${sandbox_id}")\nstats = sandbox.cache.stats()` }],
      })
    );
  },
  {
    capabilities: {
      tools: {
        health: { description: "GET /health — public health check" },
        list_sandboxes: { description: "GET /v1/sandboxes — list all sandboxes" },
        create_sandbox: { description: "POST /v1/sandboxes — create a new sandbox" },
        get_sandbox: { description: "GET /v1/sandboxes/{id} — get sandbox info" },
        delete_sandbox: { description: "DELETE /v1/sandboxes/{id} — delete sandbox" },
        update_sandbox_timeout: { description: "PUT /v1/sandboxes/{id}/timeout — update timeout" },
        resume_sandbox: { description: "POST /v1/sandboxes/{id}/resume — resume paused sandbox" },
        list_templates: { description: "GET /v1/templates — list sandbox templates" },
        get_template: { description: "GET /v1/templates/{name} — get template info" },
        execute_code: { description: "Unified code execution with modes: isolated, persistent, rich, background" },
        execute_code_isolated: { description: "Fast isolated code execution (deprecated)" },
        execute_list_processes: { description: "List background processes" },
        execute_kill_process: { description: "Kill a background process" },
        run_command: { description: "Run shell command in sandbox" },
        run_command_background: { description: "Run shell command in background" },
        list_processes: { description: "List all system processes" },
        file_read: { description: "Read file contents from sandbox" },
        file_write: { description: "Write file to sandbox" },
        file_list: { description: "List directory contents" },
        file_exists: { description: "Check if file/directory exists" },
        file_remove: { description: "Delete file or directory" },
        file_mkdir: { description: "Create directory" },
        ping_vm: { description: "Quick VM liveness check" },
        get_vm_info: { description: "Get VM agent information" },
        get_preview_url: { description: "Get public preview URL for a service" },
        get_agent_url: { description: "Get agent URL for the sandbox" },
        get_system_metrics: { description: "Get CPU, memory, disk usage" },
        env_get: { description: "Get all environment variables" },
        env_set: { description: "Set environment variables" },
        env_clear: { description: "Clear all environment variables" },
        cache_clear: { description: "Clear execution cache" },
        cache_stats: { description: "Get cache statistics" },
      },
    },
  },
  {
    basePath: "",
    verboseLogs: true,
    maxDuration: 60,
    disableSse: true,
  }
);

export { handler as GET, handler as POST, handler as DELETE };
