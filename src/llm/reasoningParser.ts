/**
 * Streaming parser that extracts reasoning blocks wrapped in `<think>`…`</think>`
 * tags from a raw content stream.  Handles tags that span across SSE chunks.
 *
 * When a provider natively separates reasoning (e.g. DeepSeek
 * `reasoning_content` or Ollama `message.thinking`) this parser is *not*
 * used — it is a fallback for models that embed reasoning inside the
 * regular `content` field.
 */

export type StreamFragment =
  | { type: "thinking"; text: string }
  | { type: "token"; text: string };

export class ReasoningStreamParser {
  private buffer = "";
  private inThinkBlock = false;
  private readonly THINK_OPEN = "<think>";
  private readonly THINK_CLOSE = "</think>";

  /**
   * Push a new chunk of text into the parser and receive zero or more
   * classified fragments.  Fragments are returned in the order they appear
   * in the stream.
   */
  write(text: string): StreamFragment[] {
    this.buffer += text;
    const fragments: StreamFragment[] = [];

    while (true) {
      if (this.inThinkBlock) {
        const endIdx = this.buffer.indexOf(this.THINK_CLOSE);
        if (endIdx === -1) {
          // No complete close tag yet.  If there is no '<' at all we can
          // safely emit the whole buffer — it cannot be the start of a tag.
          const ltIdx = this.buffer.indexOf("<");
          if (ltIdx === -1) {
            if (this.buffer) {
              fragments.push({ type: "thinking", text: this.buffer });
            }
            this.buffer = "";
          } else if (ltIdx > 0) {
            // Emit everything before the potential tag start, keep the rest.
            fragments.push({ type: "thinking", text: this.buffer.slice(0, ltIdx) });
            this.buffer = this.buffer.slice(ltIdx);
          }
          break;
        }

        const thinking = this.buffer.slice(0, endIdx);
        if (thinking) {
          fragments.push({ type: "thinking", text: thinking });
        }
        this.buffer = this.buffer.slice(endIdx + this.THINK_CLOSE.length);
        this.inThinkBlock = false;
      } else {
        const startIdx = this.buffer.indexOf(this.THINK_OPEN);
        if (startIdx === -1) {
          const ltIdx = this.buffer.indexOf("<");
          if (ltIdx === -1) {
            if (this.buffer) {
              fragments.push({ type: "token", text: this.buffer });
            }
            this.buffer = "";
          } else if (ltIdx > 0) {
            fragments.push({ type: "token", text: this.buffer.slice(0, ltIdx) });
            this.buffer = this.buffer.slice(ltIdx);
          }
          break;
        }

        const token = this.buffer.slice(0, startIdx);
        if (token) {
          fragments.push({ type: "token", text: token });
        }
        this.buffer = this.buffer.slice(startIdx + this.THINK_OPEN.length);
        this.inThinkBlock = true;
      }
    }

    return fragments;
  }

  /** Drain any trailing text once the stream has ended. */
  flush(): StreamFragment[] {
    const fragments: StreamFragment[] = [];
    if (this.buffer) {
      fragments.push({
        type: this.inThinkBlock ? "thinking" : "token",
        text: this.buffer,
      });
      this.buffer = "";
    }
    this.inThinkBlock = false;
    return fragments;
  }
}
