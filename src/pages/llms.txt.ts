import type { APIRoute } from 'astro';
import { llmsShort } from '../lib/llms';

// A plain-text guide to the site for AI assistants (llmstxt.org).
export const GET: APIRoute = () => new Response(llmsShort(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
