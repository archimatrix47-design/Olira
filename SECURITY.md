# Security Implementation Guide

This document outlines the security measures implemented in the Olira Agro Industry website.

## Authentication & Authorization

### Admin Authentication
- **JWT-based authentication** with 24-hour expiry
- **Password hashing** - passwords are never stored in client
- **Rate limiting** - 3 failed login attempts per minute per IP
- **Secure token generation** using crypto.createHmac

### Protected Endpoints
All admin endpoints require Bearer token in Authorization header:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## Input Validation & Sanitization

### Client-Side Validation
- Required field checking
- Email format validation (regex)
- Phone number format validation
- Text length limits (max 100 chars for name, 2000 for message)
- Product selection validation

### Server-Side Validation
- Email format validation
- Field length validation
- Type checking (ensure fields are strings)
- HTML sanitization to prevent XSS injection
- Request body size limits (10MB max)

## Security Headers

Implemented via Helmet.js:

- **Content-Security-Policy**: Restricts script execution to trusted sources
- **X-Frame-Options**: Prevents clickjacking (DENY)
- **X-Content-Type-Options**: Prevents MIME sniffing (nosniff)
- **Strict-Transport-Security**: Enforces HTTPS for 1 year
- **Referrer-Policy**: Controls referrer information (strict-origin-when-cross-origin)
- **X-XSS-Protection**: Legacy XSS protection enabled

## CORS (Cross-Origin Resource Sharing)

Restricted to localhost and local network IPs:

```
- http://localhost:3000
- http://127.0.0.1:3000
- http://192.168.1.1:3000
- http://192.168.40.225:3000
```

Allowed headers: Content-Type, Authorization
Credentials: Enabled for same-origin requests

## Rate Limiting

Protects against brute force and DoS attacks:

- **Inquiry submissions**: 5 requests per minute per IP
- **Email config access**: 5 requests per minute per IP
- **Admin login**: 3 attempts per minute per IP

## Data Protection

### Email Credentials
- Never stored in codebase
- Configured via environment variables (.env)
- SMTP password never exposed to client
- Email configuration endpoint requires authentication

### User Data
- Contact form submissions are sanitized
- No sensitive data stored in browser storage
- Confirmation emails are HTML-encoded
- Admin tokens have limited lifetime

## XSS (Cross-Site Scripting) Prevention

- **innerHTML replaced with createElement**: Prevents template injection
- **HTML sanitization**: All user input is HTML-escaped before rendering
- **Content-Type headers**: Set to application/json for API responses
- **CSP headers**: Restrict inline script execution

## Accessibility & Security

- **Focus indicators**: Visible outline for keyboard navigation
- **ARIA labels**: Semantic markup for screen readers
- **Form validation messages**: Clear, accessible error messages
- **Skip links**: (Implemented where needed)

## TLS/SSL Recommendations

For production deployment:

```nginx
# Redirect HTTP to HTTPS
server {
    listen 80;
    return 301 https://$server_name$request_uri;
}

# HTTPS configuration
server {
    listen 443 ssl http2;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    # Strong cipher suite
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
}
```

## Logging & Monitoring

### Logged Events
- Failed admin login attempts (with IP)
- Rate limit exceeded attempts
- Email sending errors
- Invalid CORS origins

### Not Logged
- Successful form submissions (due to privacy)
- Valid passwords (for security)
- Full request bodies (for privacy)

## Dependency Security

Regular security audits via:

```bash
npm audit
npm audit fix
```

Dependencies with known vulnerabilities should be updated immediately.

## Deployment Security

### Environment Variables Required
```bash
ADMIN_PASSWORD         # Strong password, min 8 characters
JWT_SECRET            # Cryptographically secure random string
SMTP_USER             # Email account for sending
SMTP_PASSWORD         # App-specific password (not account password)
NODE_ENV              # Set to 'production' for production
```

### Docker Security
- Non-root user (Node.js default)
- Read-only filesystem where possible
- Health checks enabled
- Resource limits recommended

## Incident Response

In case of security breach:

1. Immediately change `ADMIN_PASSWORD`
2. Regenerate `JWT_SECRET`
3. Review authentication logs
4. Check for unauthorized email configuration changes
5. Clear any compromised sessions
6. Contact security@oliraagroindustry.com

## Security Testing

Recommendations for ongoing security:

- Regular OWASP Top 10 vulnerability scanning
- Penetration testing (annually)
- Security headers audit (https://securityheaders.com)
- SSL/TLS configuration audit (https://www.ssllabs.com)

## Compliance

- GDPR: No personal data stored beyond contact forms (auto-delete after processing)
- WCAG 2.1 AA: Accessibility compliance
- HTTP Security Headers: Industry standard implementation

## Future Improvements

- [ ] Implement 2FA for admin panel
- [ ] Add request logging with privacy consideration
- [ ] Implement database for contact submissions
- [ ] Add email verification for form submissions
- [ ] Implement Web Application Firewall (WAF)
- [ ] Add CSP report-only mode for monitoring

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- [Helmet.js Documentation](https://helmetjs.github.io/)
