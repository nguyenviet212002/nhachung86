import { AppError } from '../core/errors.js';

export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const fields = {};
      for (const issue of result.error.issues) fields[issue.path.join('.')] = issue.message;
      return next(new AppError('VALIDATION_FAILED', 'Dữ liệu gửi lên chưa hợp lệ.', { status: 400, fields }));
    }
    req[source] = result.data;
    next();
  };
}
