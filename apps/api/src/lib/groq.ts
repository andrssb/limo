import OpenAI from "openai";
import { config } from "../config.js";

// Groq is OpenAI-compatible — same SDK, different baseURL + key
export const groq = new OpenAI({
  apiKey:  config.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

// Model aliases
export const MODELS = {
  fast:    "llama-3.1-8b-instant",       // fast, cheap — coaching tips, summaries
  smart:   "llama-3.3-70b-versatile",    // best — call analysis, reports, chat
  whisper: "whisper-large-v3-turbo",     // transcription
} as const;
