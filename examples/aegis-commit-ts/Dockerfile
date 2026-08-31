FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 evidence/latest/ /usr/share/nginx/html/

EXPOSE 8080
