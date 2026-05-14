import { describe, expect, it } from "vitest";
import { ReasoningStreamParser } from "../src/llm/reasoningParser.js";

describe("ReasoningStreamParser", () => {
  it("passes plain text through as tokens", () => {
    const parser = new ReasoningStreamParser();
    const frags = parser.write("Hello world");
    expect(frags).toEqual([{ type: "token", text: "Hello world" }]);
  });

  it("extracts a complete think block", () => {
    const parser = new ReasoningStreamParser();
    const frags = parser.write("Before <think>reasoning</think> After");
    expect(frags).toEqual([
      { type: "token", text: "Before " },
      { type: "thinking", text: "reasoning" },
      { type: "token", text: " After" },
    ]);
  });

  it("handles think tags that span across chunks", () => {
    const parser = new ReasoningStreamParser();
    const frags1 = parser.write("Before <thi");
    // "Before " is safely emitted because it precedes the potential tag start.
    expect(frags1).toEqual([{ type: "token", text: "Before " }]);

    const frags2 = parser.write("nk>reasoning</think> After");
    expect(frags2).toEqual([
      { type: "thinking", text: "reasoning" },
      { type: "token", text: " After" },
    ]);
  });

  it("handles close tag that spans across chunks", () => {
    const parser = new ReasoningStreamParser();
    const frags1 = parser.write("<think>reasoning</thi");
    // "reasoning" is safely emitted because it precedes the potential close-tag start.
    expect(frags1).toEqual([{ type: "thinking", text: "reasoning" }]);

    const frags2 = parser.write("nk> After");
    expect(frags2).toEqual([{ type: "token", text: " After" }]);
  });

  it("handles multiple think blocks", () => {
    const parser = new ReasoningStreamParser();
    const frags = parser.write("A <think>r1</think> B <think>r2</think> C");
    expect(frags).toEqual([
      { type: "token", text: "A " },
      { type: "thinking", text: "r1" },
      { type: "token", text: " B " },
      { type: "thinking", text: "r2" },
      { type: "token", text: " C" },
    ]);
  });

  it("emits unclosed think content on flush", () => {
    const parser = new ReasoningStreamParser();
    const frags1 = parser.write("<think>unfinished reasoning");
    // write() already emitted the buffered thinking because no '<' remains.
    expect(frags1).toEqual([{ type: "thinking", text: "unfinished reasoning" }]);
    expect(parser.flush()).toEqual([]);
  });

  it("emits trailing token content on flush", () => {
    const parser = new ReasoningStreamParser();
    const frags1 = parser.write("just a token");
    // write() already emitted the buffered token because no '<' remains.
    expect(frags1).toEqual([{ type: "token", text: "just a token" }]);
    expect(parser.flush()).toEqual([]);
  });

  it("returns empty array when nothing buffered on flush", () => {
    const parser = new ReasoningStreamParser();
    parser.write("content");
    parser.flush();
    expect(parser.flush()).toEqual([]);
  });

  it("handles chunk boundary at '<' character", () => {
    const parser = new ReasoningStreamParser();
    const frags1 = parser.write("text");
    expect(frags1).toEqual([{ type: "token", text: "text" }]);

    const frags2 = parser.write("<");
    expect(frags2).toEqual([]);

    const frags3 = parser.write("think>reason</think>");
    expect(frags3).toEqual([
      { type: "thinking", text: "reason" },
    ]);
  });

  it("handles interleaved thinking and response in one chunk", () => {
    const parser = new ReasoningStreamParser();
    const frags = parser.write("<think>step 1</think>answer 1<think>step 2</think>answer 2");
    expect(frags).toEqual([
      { type: "thinking", text: "step 1" },
      { type: "token", text: "answer 1" },
      { type: "thinking", text: "step 2" },
      { type: "token", text: "answer 2" },
    ]);
  });
});
