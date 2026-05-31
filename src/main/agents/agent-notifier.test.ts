import { describe, it, expect } from 'vitest';
import { buildToastXml } from './agent-notifier';

describe('buildToastXml', () => {
  it('produces valid XML with title and body', () => {
    const xml = buildToastXml('Test Title', 'Test body text');
    expect(xml).toContain('<text>Test Title</text>');
    expect(xml).toContain('<text>Test body text</text>');
    expect(xml).toContain('activationType="foreground"');
    expect(xml).not.toContain('<actions>');
  });

  it('includes action buttons when provided', () => {
    const xml = buildToastXml('Approval', 'Need permission', [
      { label: 'Approve', argument: 'approve' },
      { label: 'Deny', argument: 'deny' },
    ]);
    expect(xml).toContain('<actions>');
    expect(xml).toContain('content="Approve"');
    expect(xml).toContain('arguments="approve"');
    expect(xml).toContain('content="Deny"');
    expect(xml).toContain('arguments="deny"');
  });

  it('escapes XML special characters in title and body', () => {
    const xml = buildToastXml('Title <with> "special" & chars', "Body's text & <more>");
    expect(xml).toContain('Title &lt;with&gt; &quot;special&quot; &amp; chars');
    expect(xml).toContain('Body&apos;s text &amp; &lt;more&gt;');
  });

  it('escapes XML special characters in action labels and arguments', () => {
    const xml = buildToastXml('Title', 'Body', [
      { label: 'Allow <path>', argument: 'C:\\foo\\bar&baz' },
    ]);
    expect(xml).toContain('content="Allow &lt;path&gt;"');
    expect(xml).toContain('arguments="C:\\foo\\bar&amp;baz"');
  });

  it('produces no action block for empty actions array', () => {
    const xml = buildToastXml('Title', 'Body', []);
    expect(xml).not.toContain('<actions>');
  });
});
