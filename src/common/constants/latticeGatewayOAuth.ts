export const LATTICE_GATEWAY_ORIGIN = "";

export const LATTICE_GATEWAY_CLIENT_ID = "lattice-client";
export const LATTICE_GATEWAY_CLIENT_SECRET = "lattice-client";

export const LATTICE_GATEWAY_AUTHORIZE_URL = `${LATTICE_GATEWAY_ORIGIN}/oauth2/authorize`;
export const LATTICE_GATEWAY_EXCHANGE_URL = `${LATTICE_GATEWAY_ORIGIN}/api/v1/oauth2/exchange`;

export function buildAuthorizeUrl(input: { redirectUri: string; state: string }): string {
  const url = new URL(LATTICE_GATEWAY_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", LATTICE_GATEWAY_CLIENT_ID);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

export function buildExchangeBody(input: { code: string }): URLSearchParams {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", input.code);
  body.set("client_id", LATTICE_GATEWAY_CLIENT_ID);
  body.set("client_secret", LATTICE_GATEWAY_CLIENT_SECRET);
  return body;
}
