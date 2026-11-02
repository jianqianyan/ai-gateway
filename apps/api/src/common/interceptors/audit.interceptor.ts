import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from '../../modules/audit/audit.service';
import { sanitizeForAudit } from '../utils/redact';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method = String(req.method || '').toUpperCase();
    const path = String(req.path || '');
    const shouldAudit =
      path.startsWith('/api/admin') &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) &&
      !path.includes('/auth/login') &&
      !path.includes('/auth/refresh') &&
      !path.includes('/auth/logout') &&
      !path.includes('/playground/');

    if (!shouldAudit) return next.handle();

    return next.handle().pipe(
      tap((data) => {
        const user = req.user;
        if (!user) return;
        const parts = path.replace('/api/admin/', '').split('/').filter(Boolean);
        this.audit
          .log({
            adminId: user.id,
            username: user.username,
            action: `${method} ${path}`,
            targetType: parts[0],
            targetId: parts[1],
            after: sanitizeForAudit(data),
            ip: req.ip,
          })
          .catch(() => undefined);
      }),
    );
  }
}
