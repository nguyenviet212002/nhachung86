import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('OpenAPI contract', () => {
  it('serves a public document generated from the API schemas', async () => {
    const response = await request(buildApp()).get('/api/v1/docs');

    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.1.0');
    expect(response.body.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
    const registerRequired = response.body.paths['/api/v1/auth/register']
      .post.requestBody.content['application/json'].schema.required;
    expect(registerRequired).toEqual(expect.arrayContaining(['phone', 'invite_token', 'terms']));
    expect(registerRequired).not.toContain('otp_token');
    expect(response.body.paths['/api/v1/members/{id}/contacts/{field}'].get.parameters)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'id', in: 'path', required: true }),
        expect.objectContaining({ name: 'field', in: 'path', required: true }),
      ]));
    expect(response.body.paths['/api/v1/files'].post.requestBody.content['multipart/form-data'].schema)
      .toMatchObject({ required: ['file'], properties: { file: { format: 'binary' } } });
  });

  it('documents the complete route surface without exposing operation internals', async () => {
    const response = await request(buildApp()).get('/api/v1/docs');
    const paths = Object.keys(response.body.paths);

    expect(paths).toEqual(expect.arrayContaining([
      '/api/v1/health',
      '/api/v1/docs',
      '/api/v1/areas',
      '/api/v1/auth/login',
      '/api/v1/files/{id}',
      '/api/v1/ops/audit-log/verify',
      '/api/v1/ops/pending-actions/{id}/sign',
    ]));
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('refreshTokenHash');
  });
});
