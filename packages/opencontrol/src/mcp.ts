import {
  CallToolRequestSchema,
  CallToolResult,
  InitializeRequestSchema,
  InitializeResult,
  JSONRPCRequest,
  JSONRPCResponse,
  ListToolsRequestSchema,
  ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { Tool } from "./tool.js"

const RequestSchema = z.union([
  InitializeRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
])
type RequestSchema = z.infer<typeof RequestSchema>

function getInputSchema(args: any) {
  // If no args, return empty object schema
  if (!args) {
    return z.toJSONSchema(z.object({}))
  }

  // Check if it's a zod schema (has _zod property)
  if (args && typeof args === "object" && "_zod" in args) {
    return z.toJSONSchema(args)
  }

  // Fallback for other StandardSchemaV1 types - return a generic object schema
  // This maintains compatibility while we transition
  return z.toJSONSchema(z.object({}))
}

export function createMcp(input: { tools: Tool[] }) {
  return {
    async process(message: JSONRPCRequest) {
      const parsed = RequestSchema.parse(message)

      const result = await (async () => {
        if (parsed.method === "initialize")
          return {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: "opencontrol",
              version: "0.0.1",
            },
          } satisfies InitializeResult

        if (parsed.method === "tools/list") {
          return {
            tools: input.tools.map((tool) => ({
              name: tool.name,
              inputSchema: getInputSchema(tool.args) as any,
              description: tool.description,
            })),
          } satisfies ListToolsResult
        }

        if (parsed.method === "tools/call") {
          const tool = input.tools.find(
            (tool) => tool.name === parsed.params.name,
          )
          if (!tool) throw new Error("tool not found")

          let args = parsed.params.arguments
          if (tool.args) {
            const validated = await tool.args["~standard"].validate(args)
            if (validated.issues) {
              return {
                isError: true,
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(validated.issues),
                  },
                ],
              } satisfies CallToolResult
            }
            args = validated.value as any
          }

          return tool
            .run(args)
            .catch(
              (error) =>
                ({
                  isError: true,
                  content: [
                    {
                      type: "text",
                      text: error.message,
                    },
                  ],
                }) satisfies CallToolResult,
            )
            .then(
              (result) =>
                ({
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify(result, null, 2),
                    },
                  ],
                }) satisfies CallToolResult,
            )
        }

        throw new Error("not implemented")
      })()

      return {
        jsonrpc: "2.0",
        id: message.id,
        result,
      } satisfies JSONRPCResponse
    },
  }
}
