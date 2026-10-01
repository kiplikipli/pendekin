# Rate limits

Pendekin currently has no application-defined request quota, rate-limit response schema, or guaranteed `Retry-After` value. Cloudflare or upstream services may impose limits outside this API contract. Use moderate request rates and exponential backoff for 502 and 503 responses. If an HTTP response includes `Retry-After`, follow it.
