import { useState, useEffect } from "react";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const CURSOR_FRAMES = [" ", "▋"];

export function useSpinner(active: boolean, fps = 12): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) { setFrame(0); return; }
    const id = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 1000 / fps);
    return () => clearInterval(id);
  }, [active, fps]);
  return FRAMES[frame];
}

export function useCursor(active: boolean, fps = 2): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) { setFrame(0); return; }
    const id = setInterval(() => setFrame((f) => (f + 1) % CURSOR_FRAMES.length), 1000 / fps);
    return () => clearInterval(id);
  }, [active, fps]);
  return CURSOR_FRAMES[frame];
}
