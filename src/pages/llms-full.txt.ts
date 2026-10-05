import type { APIRoute } from 'astro';
import { llmsFull } from '../lib/llms';

// Every product's details as plain text, for AI assistants (llmstxt.org).
export const GET: APIRoute = () => new Response(llmsFull(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
