import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { toString } from "mdast-util-to-string";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { Root, RootContent } from "mdast";

const execFileAsync = promisify(execFile);

export type KnowledgeChunk = {
  ordinal: number;
  sectionPath: string[];
  heading: string | null;
  content: string;
  tokenCount: number;
  contentHash: string;
};

const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));
export const hashContent = (content: string) => createHash("sha256").update(content).digest("hex");

type Block = { sectionPath: string[]; heading: string | null; text: string };

export function chunkMarkdown(markdown: string, targetTokens = 600, overlapTokens = 80): KnowledgeChunk[] {
  const tree = unified().use(remarkParse).parse(markdown) as Root;
  const headings: string[] = [];
  const blocks: Block[] = [];

  for (const node of tree.children) {
    if (node.type === "heading") {
      const heading = toString(node).trim();
      headings.splice(node.depth - 1);
      headings[node.depth - 1] = heading;
      continue;
    }
    const text = blockText(node).trim();
    if (text) {
      blocks.push({ sectionPath: headings.filter(Boolean), heading: headings.at(-1) ?? null, text });
    }
  }

  const chunks: KnowledgeChunk[] = [];
  let current: Block[] = [];
  let tokenCount = 0;

  const flush = () => {
    if (!current.length) return;
    const content = current.map((block) => block.text).join("\n\n");
    const last = current.at(-1)!;
    chunks.push({
      ordinal: chunks.length,
      sectionPath: last.sectionPath,
      heading: last.heading,
      content,
      tokenCount: estimateTokens(content),
      contentHash: hashContent(content),
    });

    const overlap: Block[] = [];
    let overlapCount = 0;
    for (let index = current.length - 1; index >= 0 && overlapCount < overlapTokens; index -= 1) {
      const block = current[index]!;
      overlap.unshift(block);
      overlapCount += estimateTokens(block.text);
    }
    current = overlap;
    tokenCount = overlapCount;
  };

  for (const block of blocks) {
    const blockTokens = estimateTokens(block.text);
    if (current.length && tokenCount + blockTokens > targetTokens) flush();
    current.push(block);
    tokenCount += blockTokens;
  }
  flush();
  return chunks;
}

function blockText(node: RootContent): string {
  if (node.type === "code") return `\`\`\`${node.lang ?? ""}\n${node.value}\n\`\`\``;
  return toString(node);
}

export async function convertWithCommand(command: string, filePath: string): Promise<string> {
  const [executable, ...args] = command.split(/\s+/).filter(Boolean);
  if (!executable) throw new Error("Converter command is empty");
  const { stdout } = await execFileAsync(executable, [...args, filePath], {
    maxBuffer: 20 * 1024 * 1024,
  });
  if (!stdout.trim()) throw new Error("Converter produced no Markdown");
  return stdout;
}

export const convertWithMarkItDown = (filePath: string, command = process.env.MARKITDOWN_COMMAND) => {
  if (!command) throw new Error("MARKITDOWN_COMMAND is not configured");
  return convertWithCommand(command, filePath);
};

export const convertWithDocling = (filePath: string, command = process.env.DOCLING_COMMAND) => {
  if (!command) throw new Error("DOCLING_COMMAND is not configured");
  return convertWithCommand(command, filePath);
};
