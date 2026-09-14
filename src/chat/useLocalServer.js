// Stand up an in-process MCP server and hand the
// connected client to the chat as a `localServers` entry. Mirrors the pattern in
// apps-wb/wb-cartography-assistant/src/lib/app-control.ts.
import { useEffect, useState } from 'react';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

/**
 * @param {() => import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} build
 * @param {string} name  tool namespace → `${name}__tool`
 */
export function useLocalServer(build, name) {
  const [local, setLocal] = useState([]);
  useEffect(() => {
    let disposed = false, client;
    (async () => {
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await build().connect(st);
      client = new Client({ name: `${name}-bridge`, version: '0.0.0' });
      await client.connect(ct);
      if (disposed) return client.close();
      setLocal([{ name, client }]);
    })();
    return () => { disposed = true; client?.close().catch(() => {}); };
    // Build once; mutable state is read lazily inside the tools.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return local;
}
