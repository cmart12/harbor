import { describe, it, expect } from 'vitest';
import { curationApprovalHandler } from './curation-approval';

describe('curationApprovalHandler', () => {
  it('approves workiq MCP tool calls', async () => {
    const result = await curationApprovalHandler({ kind: 'mcp', serverName: 'workiq' });
    expect(result).toEqual({ kind: 'approve-once' });
  });

  it('approves slack MCP tool calls', async () => {
    const result = await curationApprovalHandler({ kind: 'mcp', serverName: 'slack' });
    expect(result).toEqual({ kind: 'approve-once' });
  });

  it('rejects non-allowed MCP server', async () => {
    const result = await curationApprovalHandler({ kind: 'mcp', serverName: 'datadog' });
    expect(result).toEqual({ kind: 'reject' });
  });

  it('rejects MCP with no serverName', async () => {
    const result = await curationApprovalHandler({ kind: 'mcp' });
    expect(result).toEqual({ kind: 'reject' });
  });

  it('approves extension-management for workiq', async () => {
    const result = await curationApprovalHandler({ kind: 'extension-management', extensionName: 'workiq' });
    expect(result).toEqual({ kind: 'approve-once' });
  });

  it('approves extension-permission-access for slack', async () => {
    const result = await curationApprovalHandler({ kind: 'extension-permission-access', extensionName: 'slack' });
    expect(result).toEqual({ kind: 'approve-once' });
  });

  it('rejects extension-management for non-allowed extension', async () => {
    const result = await curationApprovalHandler({ kind: 'extension-management', extensionName: 'kusto' });
    expect(result).toEqual({ kind: 'reject' });
  });

  it('approves read requests', async () => {
    const result = await curationApprovalHandler({ kind: 'read' });
    expect(result).toEqual({ kind: 'approve-once' });
  });

  it('rejects shell requests', async () => {
    const result = await curationApprovalHandler({ kind: 'shell' });
    expect(result).toEqual({ kind: 'reject' });
  });

  it('rejects write requests', async () => {
    const result = await curationApprovalHandler({ kind: 'write' });
    expect(result).toEqual({ kind: 'reject' });
  });

  it('rejects url requests', async () => {
    const result = await curationApprovalHandler({ kind: 'url' });
    expect(result).toEqual({ kind: 'reject' });
  });

  it('rejects unknown kinds', async () => {
    const result = await curationApprovalHandler({ kind: 'some-new-thing' });
    expect(result).toEqual({ kind: 'reject' });
  });
});
