// 클로드 연결(MCP 커넥터)의 로그인(OAuth) 설정
// 라이브러리가 /oauth/token, /oauth/register, /.well-known/* 를 처리하고,
// /mcp 요청은 토큰을 확인한 뒤에만 handleMcp 로 넘김 (ctx.props.userId = 연결한 사장님 계정)
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { handleMcp } from './server.js';

/** 클로드 설정 → 커넥터 → 커스텀 커넥터 추가에 넣는 주소: MCP_URL */
export const MCP_ORIGIN = 'https://app.costnote.co.kr';
export const MCP_URL = `${MCP_ORIGIN}/mcp`;
const DAY = 86400;

export function makeProvider(defaultHandler, { fetchImpl } = {}) {
  return new OAuthProvider({
    apiRoute: MCP_URL,
    apiHandler: { fetch: (request, env, ctx) => handleMcp(request, env, ctx.props.userId, fetchImpl) },
    defaultHandler,
    authorizeEndpoint: '/oauth/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    scopesSupported: ['costnote', 'offline_access'],
    requiredScopes: ['costnote'],
    resourceMetadata: { resource: MCP_URL, authorization_servers: [MCP_ORIGIN] },
    clientIdMetadataDocumentEnabled: true,
    // 연결은 쓰는 동안 계속 유지, 60일 동안 안 쓰면 다시 연결
    refreshTokenTTL: 60 * DAY,
    refreshTokenIdleTTL: 60 * DAY,
  });
}
