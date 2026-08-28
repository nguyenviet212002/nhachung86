import * as auth from '../modules/auth/schema.js';
import * as files from '../modules/files/schema.js';
import * as invites from '../modules/invites/schema.js';
import * as joinRequests from '../modules/join-requests/schema.js';
import * as members from '../modules/members/schema.js';
import * as ops from '../modules/ops/schema.js';
import * as notifications from '../modules/notifications/schema.js';
import * as capabilities from '../modules/capabilities/schema.js';
import * as jobs from '../modules/jobs/schema.js';
import * as games from '../modules/games/schema.js';
import * as projects from '../modules/projects/schema.js';
import * as aid from '../modules/aid/schema.js';
import * as complaints from '../modules/complaints/schema.js';
import * as verifications from '../modules/verifications/schema.js';
import * as fund from '../modules/fund/schema.js';
import * as moderation from '../modules/moderation/schema.js';

const TYPE_NAMES = {
  ZodAny: 'ZodAny',
  ZodArray: 'ZodArray',
  ZodBoolean: 'ZodBoolean',
  ZodDate: 'ZodDate',
  ZodDefault: 'ZodDefault',
  ZodEffects: 'ZodEffects',
  ZodEnum: 'ZodEnum',
  ZodIntersection: 'ZodIntersection',
  ZodLiteral: 'ZodLiteral',
  ZodNullable: 'ZodNullable',
  ZodNumber: 'ZodNumber',
  ZodObject: 'ZodObject',
  ZodOptional: 'ZodOptional',
  ZodRecord: 'ZodRecord',
  ZodString: 'ZodString',
  ZodUnion: 'ZodUnion',
  ZodUnknown: 'ZodUnknown',
};

function typeName(schema) {
  return schema?._def?.typeName;
}

function unwrap(schema) {
  let current = schema;
  let nullable = false;
  let optional = false;

  while (current?._def) {
    const kind = typeName(current);
    if (kind === TYPE_NAMES.ZodOptional) {
      optional = true;
      current = current._def.innerType;
    } else if (kind === TYPE_NAMES.ZodDefault) {
      optional = true;
      current = current._def.innerType;
    } else if (kind === TYPE_NAMES.ZodNullable) {
      nullable = true;
      current = current._def.innerType;
    } else if (kind === TYPE_NAMES.ZodEffects) {
      current = current._def.schema;
    } else {
      break;
    }
  }

  return { schema: current, nullable, optional };
}

function checksToSchema(schema, output) {
  for (const check of schema?._def?.checks ?? []) {
    if (check.kind === 'min') {
      if (output.type === 'string') output.minLength = check.value;
      if (output.type === 'number' || output.type === 'integer') output.minimum = check.value;
    }
    if (check.kind === 'max') {
      if (output.type === 'string') output.maxLength = check.value;
      if (output.type === 'number' || output.type === 'integer') output.maximum = check.value;
    }
    if (check.kind === 'length' && output.type === 'string') {
      output.minLength = check.value;
      output.maxLength = check.value;
    }
    if (check.kind === 'regex') output.pattern = check.regex.source;
    if (check.kind === 'email') output.format = 'email';
    if (check.kind === 'uuid') output.format = 'uuid';
  }
  return output;
}

export function zodToOpenApi(schema) {
  const { schema: inner, nullable } = unwrap(schema);
  const kind = typeName(inner);
  let output;

  switch (kind) {
    case TYPE_NAMES.ZodString:
      output = checksToSchema(inner, { type: 'string' });
      break;
    case TYPE_NAMES.ZodNumber:
      output = checksToSchema(inner, {
        type: inner._def.checks?.some((check) => check.kind === 'int') ? 'integer' : 'number',
      });
      break;
    case TYPE_NAMES.ZodBoolean:
      output = { type: 'boolean' };
      break;
    case TYPE_NAMES.ZodDate:
      output = { type: 'string', format: 'date-time' };
      break;
    case TYPE_NAMES.ZodEnum:
      output = { type: 'string', enum: inner._def.values };
      break;
    case TYPE_NAMES.ZodLiteral:
      output = { enum: [inner._def.value] };
      if (typeof inner._def.value === 'boolean') output.type = 'boolean';
      if (typeof inner._def.value === 'string') output.type = 'string';
      if (typeof inner._def.value === 'number') output.type = 'number';
      break;
    case TYPE_NAMES.ZodArray:
      output = { type: 'array', items: zodToOpenApi(inner._def.type) };
      break;
    case TYPE_NAMES.ZodRecord:
      output = { type: 'object', additionalProperties: zodToOpenApi(inner._def.valueType) };
      break;
    case TYPE_NAMES.ZodObject: {
      const properties = {};
      const required = [];
      const shape = inner._def.shape();
      for (const [name, property] of Object.entries(shape)) {
        const unwrapped = unwrap(property);
        properties[name] = zodToOpenApi(property);
        if (!unwrapped.optional) required.push(name);
      }
      output = { type: 'object', properties };
      if (required.length > 0) output.required = required;
      if (inner._def.unknownKeys === 'strict') output.additionalProperties = false;
      break;
    }
    case TYPE_NAMES.ZodUnion:
      output = { oneOf: inner._def.options.map((option) => zodToOpenApi(option)) };
      break;
    case TYPE_NAMES.ZodIntersection:
      output = {
        allOf: [zodToOpenApi(inner._def.left), zodToOpenApi(inner._def.right)],
      };
      break;
    case TYPE_NAMES.ZodAny:
    case TYPE_NAMES.ZodUnknown:
    default:
      output = {};
      break;
  }

  return nullable ? { ...output, nullable: true } : output;
}

function schemaProperties(schema) {
  const { schema: inner } = unwrap(schema);
  return inner?._def?.shape?.() ?? {};
}

function parameters(schema, location, names = null) {
  return Object.entries(schemaProperties(schema))
    .filter(([name]) => !names || names.includes(name))
    .map(([name, property]) => {
      const unwrapped = unwrap(property);
      return {
        name,
        in: location,
        required: location === 'path' || !unwrapped.optional,
        schema: zodToOpenApi(property),
      };
    });
}

function jsonResponse(description = 'JSON response') {
  return { description, content: { 'application/json': { schema: {} } } };
}

function endpoint(method, path, {
  body,
  query,
  pathParams,
  response = jsonResponse(),
  authRequired = true,
  contentType,
  requestBody,
} = {}) {
  const operation = {
    operationId: `${method.toLowerCase()}_${path.replaceAll('/', '_').replaceAll(/[{}]/g, '') || 'root'}`,
    responses: { '200': response },
  };
  if (authRequired) operation.security = [{ bearerAuth: [] }];
  const params = [];
  if (query) params.push(...parameters(query, 'query'));
  if (pathParams) params.push(...parameters(pathParams, 'path'));
  if (params.length) operation.parameters = params;
  if (body || requestBody) {
    operation.requestBody = {
      required: true,
      content: {
        [contentType ?? 'application/json']: { schema: requestBody ?? zodToOpenApi(body) },
      },
    };
  }
  return [method.toLowerCase(), operation];
}

export function buildOpenApi() {
  const paths = {};
  const add = (path, ...definitions) => {
    paths[path] ??= {};
    for (const [method, operation] of definitions) paths[path][method] = operation;
  };

  add('/api/v1/health', endpoint('GET', '/api/v1/health', { authRequired: false }));
  add('/api/v1/docs', endpoint('GET', '/api/v1/docs', { authRequired: false }));
  add('/api/v1/areas', endpoint('GET', '/api/v1/areas', { authRequired: false }));

  add('/api/v1/auth/otp/request', endpoint('POST', '/api/v1/auth/otp/request', { body: auth.otpRequestSchema, authRequired: false }));
  add('/api/v1/auth/otp/verify', endpoint('POST', '/api/v1/auth/otp/verify', { body: auth.otpVerifySchema, authRequired: false }));
  add('/api/v1/auth/register', endpoint('POST', '/api/v1/auth/register', { body: auth.registerSchema, authRequired: false, response: { description: 'Created' } }));
  add('/api/v1/auth/login', endpoint('POST', '/api/v1/auth/login', { body: auth.loginSchema, authRequired: false }));
  add('/api/v1/auth/refresh', endpoint('POST', '/api/v1/auth/refresh', { body: auth.refreshSchema, authRequired: false }));
  add('/api/v1/auth/me', endpoint('GET', '/api/v1/auth/me'));

  add('/api/v1/files', endpoint('POST', '/api/v1/files', {
    authRequired: true,
    contentType: 'multipart/form-data',
    requestBody: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        purpose: { type: 'string', enum: ['member_avatar', 'member_cover'] },
      },
    },
    response: { description: 'Created' },
  }));
  add('/api/v1/files/{id}', endpoint('GET', '/api/v1/files/{id}', { pathParams: files.idParamSchema, response: { description: 'JPEG file bytes', content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } } } } }));

  add('/api/v1/notifications',
    endpoint('GET', '/api/v1/notifications', { query: notifications.listQuerySchema }),
    endpoint('POST', '/api/v1/notifications', { body: notifications.createSchema, response: { description: 'Created' } }));
  add('/api/v1/notifications/stream', endpoint('GET', '/api/v1/notifications/stream'));
  add('/api/v1/notifications/unread-count', endpoint('GET', '/api/v1/notifications/unread-count'));
  add('/api/v1/notifications/{id}/read', endpoint('POST', '/api/v1/notifications/{id}/read', { pathParams: notifications.idParamSchema }));
  add('/api/v1/notifications/read-all', endpoint('POST', '/api/v1/notifications/read-all'));
  add('/api/v1/messages',
    endpoint('GET', '/api/v1/messages', { query: notifications.listQuerySchema }),
    endpoint('POST', '/api/v1/messages', { body: notifications.messageSchema, response: { description: 'Created' } }));

  add('/api/v1/guarantee-invites',
    endpoint('POST', '/api/v1/guarantee-invites', { body: invites.createSchema, response: { description: 'Created' } }),
    endpoint('GET', '/api/v1/guarantee-invites', { query: invites.listQuerySchema }));
  add('/api/v1/guarantee-invites/{id}/revoke', endpoint('POST', '/api/v1/guarantee-invites/{id}/revoke', { pathParams: invites.idParamSchema, body: invites.revokeSchema }));

  add('/api/v1/join-requests', endpoint('GET', '/api/v1/join-requests', { query: joinRequests.listQuerySchema }));
  add('/api/v1/join-requests/{id}', endpoint('GET', '/api/v1/join-requests/{id}', { pathParams: joinRequests.idParamSchema }));
  add('/api/v1/join-requests/{id}/confirm-met', endpoint('POST', '/api/v1/join-requests/{id}/confirm-met', { pathParams: joinRequests.idParamSchema, body: joinRequests.confirmMetSchema }));
  add('/api/v1/join-requests/{id}/approve', endpoint('POST', '/api/v1/join-requests/{id}/approve', { pathParams: joinRequests.idParamSchema, body: joinRequests.approveSchema }));
  add('/api/v1/join-requests/{id}/reject', endpoint('POST', '/api/v1/join-requests/{id}/reject', { pathParams: joinRequests.idParamSchema, body: joinRequests.rejectSchema }));

  add('/api/v1/members', endpoint('GET', '/api/v1/members', { query: members.listQuerySchema }));
  add('/api/v1/members/me',
    endpoint('GET', '/api/v1/members/me'),
    endpoint('PATCH', '/api/v1/members/me', { body: members.updateMeSchema }));
  add('/api/v1/members/me/relations', endpoint('GET', '/api/v1/members/me/relations'));
  add('/api/v1/members/me/contact-requests', endpoint('GET', '/api/v1/members/me/contact-requests', { query: members.contactRequestQuerySchema }));
  add('/api/v1/members/me/contact-requests/{id}', endpoint('PATCH', '/api/v1/members/me/contact-requests/{id}', { pathParams: members.contactRequestParamSchema, body: members.contactDecisionSchema }));
  add('/api/v1/members/me/privacy', endpoint('GET', '/api/v1/members/me/privacy'));
  add('/api/v1/members/me/privacy/{field}', endpoint('PATCH', '/api/v1/members/me/privacy/{field}', { pathParams: members.privacyParamSchema, body: members.privacyUpdateSchema }));
  add('/api/v1/members/me/profile-views', endpoint('GET', '/api/v1/members/me/profile-views', { query: members.profileViewsQuerySchema }));
  add('/api/v1/members/{id}/contact-requests', endpoint('POST', '/api/v1/members/{id}/contact-requests', { pathParams: members.idParamSchema, body: members.contactRequestSchema, response: { description: 'Created' } }));
  add('/api/v1/members/{id}', endpoint('GET', '/api/v1/members/{id}', { pathParams: members.idParamSchema }));
  add('/api/v1/members/{id}/contacts/{field}', endpoint('GET', '/api/v1/members/{id}/contacts/{field}', { pathParams: members.contactFieldParamSchema }));

  add('/api/v1/capabilities',
    endpoint('GET', '/api/v1/capabilities', { query: capabilities.listQuerySchema }),
    endpoint('POST', '/api/v1/capabilities', { body: capabilities.createSchema, response: { description: 'Created' } }));
  add('/api/v1/capabilities/{id}',
    endpoint('GET', '/api/v1/capabilities/{id}', { pathParams: capabilities.idParamSchema }),
    endpoint('PATCH', '/api/v1/capabilities/{id}', { pathParams: capabilities.idParamSchema, body: capabilities.updateSchema }),
    endpoint('DELETE', '/api/v1/capabilities/{id}', { pathParams: capabilities.idParamSchema, response: { description: 'No content' } }));
  add('/api/v1/capabilities/{id}/photos', endpoint('POST', '/api/v1/capabilities/{id}/photos', { pathParams: capabilities.idParamSchema, body: capabilities.photoSchema, response: { description: 'Created' } }));
  add('/api/v1/capabilities/{id}/photos/{photoId}', endpoint('DELETE', '/api/v1/capabilities/{id}/photos/{photoId}', { pathParams: capabilities.photoParamSchema, response: { description: 'No content' } }));

  add('/api/v1/jobs',
    endpoint('GET', '/api/v1/jobs', { query: jobs.listQuerySchema }),
    endpoint('POST', '/api/v1/jobs', { body: jobs.createSchema, response: { description: 'Created' } }));
  add('/api/v1/jobs/ready', endpoint('GET', '/api/v1/jobs/ready', { query: jobs.readyQuerySchema }));
  add('/api/v1/jobs/ready/me',
    endpoint('GET', '/api/v1/jobs/ready/me'),
    endpoint('PUT', '/api/v1/jobs/ready/me', { body: jobs.readySchema }),
    endpoint('DELETE', '/api/v1/jobs/ready/me', { response: { description: 'No content' } }));
  add('/api/v1/jobs/connections', endpoint('GET', '/api/v1/jobs/connections', { query: jobs.readyQuerySchema }));
  add('/api/v1/jobs/{id}',
    endpoint('GET', '/api/v1/jobs/{id}', { pathParams: jobs.idParamSchema }),
    endpoint('PATCH', '/api/v1/jobs/{id}', { pathParams: jobs.idParamSchema, body: jobs.updateSchema }),
    endpoint('DELETE', '/api/v1/jobs/{id}', { pathParams: jobs.idParamSchema, response: { description: 'No content' } }));
  add('/api/v1/jobs/{id}/images', endpoint('POST', '/api/v1/jobs/{id}/images', { pathParams: jobs.idParamSchema, body: jobs.imageSchema, response: { description: 'Created' } }));
  add('/api/v1/jobs/{id}/images/{fileId}', endpoint('DELETE', '/api/v1/jobs/{id}/images/{fileId}', { pathParams: jobs.imageParamSchema, response: { description: 'No content' } }));
  add('/api/v1/jobs/{id}/applications', endpoint('POST', '/api/v1/jobs/{id}/applications', { pathParams: jobs.idParamSchema, body: jobs.applySchema, response: { description: 'Created' } }));
  add('/api/v1/jobs/{id}/applications/{connectionId}', endpoint('PATCH', '/api/v1/jobs/{id}/applications/{connectionId}', { pathParams: jobs.applicationParamSchema, body: jobs.applicationUpdateSchema }));
  add('/api/v1/jobs/{id}/applications/me', endpoint('DELETE', '/api/v1/jobs/{id}/applications/me', { pathParams: jobs.idParamSchema, response: { description: 'No content' } }));
  add('/api/v1/jobs/{id}/introductions',
    endpoint('GET', '/api/v1/jobs/{id}/introductions', { pathParams: jobs.idParamSchema }),
    endpoint('POST', '/api/v1/jobs/{id}/introductions', { pathParams: jobs.idParamSchema, body: jobs.introductionCreateSchema, response: { description: 'Created' } }));
  add('/api/v1/jobs/{id}/introductions/{introductionId}', endpoint('PATCH', '/api/v1/jobs/{id}/introductions/{introductionId}', { pathParams: jobs.introductionParamSchema, body: jobs.introductionConsentSchema }));

  add('/api/v1/projects',
    endpoint('GET', '/api/v1/projects', { query: projects.listQuerySchema }),
    endpoint('POST', '/api/v1/projects', { body: projects.createSchema, response: { description: 'Created' } }));
  add('/api/v1/projects/{id}',
    endpoint('GET', '/api/v1/projects/{id}', { pathParams: projects.idParamSchema }),
    endpoint('PATCH', '/api/v1/projects/{id}', { pathParams: projects.idParamSchema, body: projects.updateSchema }),
    endpoint('DELETE', '/api/v1/projects/{id}', { pathParams: projects.idParamSchema, response: { description: 'No content' } }));
  add('/api/v1/projects/{id}/join', endpoint('POST', '/api/v1/projects/{id}/join', { pathParams: projects.idParamSchema }));

  add('/api/v1/aid',
    endpoint('GET', '/api/v1/aid', { query: aid.listQuerySchema }),
    endpoint('POST', '/api/v1/aid', { body: aid.createSchema, response: { description: 'Created' } }));
  add('/api/v1/aid/{id}',
    endpoint('GET', '/api/v1/aid/{id}', { pathParams: aid.idParamSchema }),
    endpoint('PATCH', '/api/v1/aid/{id}', { pathParams: aid.idParamSchema, body: aid.updateSchema }),
    endpoint('DELETE', '/api/v1/aid/{id}', { pathParams: aid.idParamSchema, response: { description: 'No content' } }));
  add('/api/v1/aid/{id}/offers', endpoint('POST', '/api/v1/aid/{id}/offers', { pathParams: aid.idParamSchema, body: aid.offerSchema, response: { description: 'Created' } }));
  add('/api/v1/aid/{id}/photos', endpoint('POST', '/api/v1/aid/{id}/photos', { pathParams: aid.idParamSchema, body: aid.photoSchema, response: { description: 'Created' } }));
  add('/api/v1/aid/{id}/photos/{photoId}', endpoint('DELETE', '/api/v1/aid/{id}/photos/{photoId}', { pathParams: aid.photoParamSchema, response: { description: 'No content' } }));

  add('/api/v1/complaints',
    endpoint('GET', '/api/v1/complaints', { query: complaints.listQuerySchema }),
    endpoint('POST', '/api/v1/complaints', { body: complaints.createSchema, response: { description: 'Created' } }));
  add('/api/v1/complaints/{id}', endpoint('PATCH', '/api/v1/complaints/{id}', { pathParams: complaints.idParamSchema, body: complaints.decideSchema }));

  add('/api/v1/verifications',
    endpoint('GET', '/api/v1/verifications', { query: verifications.listQuerySchema }),
    endpoint('POST', '/api/v1/verifications', { body: verifications.createSchema, response: { description: 'Created' } }));
  add('/api/v1/verifications/me', endpoint('GET', '/api/v1/verifications/me'));
  add('/api/v1/verifications/{id}', endpoint('PATCH', '/api/v1/verifications/{id}', { pathParams: verifications.idParamSchema, body: verifications.decideSchema }));

  add('/api/v1/fund/entries',
    endpoint('GET', '/api/v1/fund/entries', { query: fund.listQuerySchema }),
    endpoint('POST', '/api/v1/fund/entries', { body: fund.createEntrySchema, response: { description: 'Created' } }));
  add('/api/v1/fund/entries/{id}/lock', endpoint('POST', '/api/v1/fund/entries/{id}/lock', { pathParams: fund.idParamSchema }));

  add('/api/v1/moderation',
    endpoint('GET', '/api/v1/moderation', { query: moderation.listQuerySchema }),
    endpoint('POST', '/api/v1/moderation', { body: moderation.createSchema, response: { description: 'Created' } }));
  add('/api/v1/moderation/{id}', endpoint('PATCH', '/api/v1/moderation/{id}', { pathParams: moderation.idParamSchema, body: moderation.decideSchema }));

  add('/api/v1/games',
    endpoint('GET', '/api/v1/games', { query: games.listQuerySchema }));
  add('/api/v1/games/challenges',
    endpoint('POST', '/api/v1/games/challenges', { body: games.challengeSchema, response: { description: 'Created' } }));
  add('/api/v1/games/challenges/{id}/accept',
    endpoint('POST', '/api/v1/games/challenges/{id}/accept', { pathParams: games.idParamSchema }));
  add('/api/v1/games/challenges/{id}/decline',
    endpoint('POST', '/api/v1/games/challenges/{id}/decline', { pathParams: games.idParamSchema }));
  add('/api/v1/games/quick-match',
    endpoint('POST', '/api/v1/games/quick-match', { response: { description: 'Matched or queued' } }),
    endpoint('DELETE', '/api/v1/games/quick-match'));
  add('/api/v1/games/{id}',
    endpoint('GET', '/api/v1/games/{id}', { pathParams: games.idParamSchema }));
  add('/api/v1/games/{id}/moves',
    endpoint('POST', '/api/v1/games/{id}/moves', { pathParams: games.idParamSchema, body: games.moveSchema }));
  add('/api/v1/games/{id}/resign',
    endpoint('POST', '/api/v1/games/{id}/resign', { pathParams: games.idParamSchema }));
  add('/api/v1/games/{id}/stream',
    endpoint('GET', '/api/v1/games/{id}/stream', { pathParams: games.idParamSchema }));

  add('/api/v1/ops/audit-log', endpoint('GET', '/api/v1/ops/audit-log', { query: ops.listAuditLogSchema }));
  add('/api/v1/ops/audit-log/verify', endpoint('GET', '/api/v1/ops/audit-log/verify', { query: ops.verifyChainSchema }));
  add('/api/v1/ops/dashboard', endpoint('GET', '/api/v1/ops/dashboard'));
  add('/api/v1/ops/permissions', endpoint('GET', '/api/v1/ops/permissions'));
  add('/api/v1/ops/roles', endpoint('GET', '/api/v1/ops/roles'));
  add('/api/v1/ops/members/{id}/roles/{role}',
    endpoint('PUT', '/api/v1/ops/members/{id}/roles/{role}', { pathParams: ops.roleParamSchema }),
    endpoint('DELETE', '/api/v1/ops/members/{id}/roles/{role}', { pathParams: ops.roleParamSchema, response: { description: 'No content' } }));
  add('/api/v1/ops/pending-actions',
    endpoint('GET', '/api/v1/ops/pending-actions', { query: ops.listActionsSchema }),
    endpoint('POST', '/api/v1/ops/pending-actions', { body: ops.createActionSchema, response: { description: 'Created' } }));
  add('/api/v1/ops/pending-actions/{id}/sign', endpoint('POST', '/api/v1/ops/pending-actions/{id}/sign', { pathParams: ops.idParamSchema, body: ops.signActionSchema }));
  add('/api/v1/ops/pending-actions/{id}', endpoint('DELETE', '/api/v1/ops/pending-actions/{id}', { pathParams: ops.idParamSchema, response: { description: 'No content' } }));
  add('/api/v1/ops/backups', endpoint('GET', '/api/v1/ops/backups', { query: ops.listBackupsSchema }));

  return {
    openapi: '3.1.0',
    info: {
      title: 'Nhà Chung API',
      version: '1.0.0',
      description: 'Tài liệu sinh từ các schema Zod đang bảo vệ request của API.',
    },
    servers: [{ url: '/' }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
  };
}
