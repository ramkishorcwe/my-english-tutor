import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// All user data lives in Supabase; no ISR or Cloudflare cache bindings are needed.
export default defineCloudflareConfig({});
