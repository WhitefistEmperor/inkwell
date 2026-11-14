// The one place the frontend talks to the backend. Every component calls
// api(), so the token header and error handling are written once.
const TOKEN_KEY = 'inkwell_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

// The server reports problems as { errors: { field: ["message", ...] } }.
export class ApiError extends Error {
  constructor(status, errors = {}) {
    // e.g. "email has already been taken"
    const lines = Object.entries(errors).flatMap(([field, messages]) => messages.map((m) => `${field} ${m}`));
    super(lines[0] || 'Request failed');
    this.status = status;
    this.lines = lines;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  const token = tokenStore.get();
  if (token) headers.Authorization = `Token ${token}`; // the scheme the RealWorld spec uses

  const res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null; // success with no content (deletes)

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.errors);
  return data;
}

// Turns { tag: 'sql', limit: 10, author: undefined } into "?tag=sql&limit=10".
export function toQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
