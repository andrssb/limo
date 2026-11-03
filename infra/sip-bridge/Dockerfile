FROM ubuntu:24.04

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        asterisk \
        gettext-base \
        python3 \
        tini \
    && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/limo-sip-entrypoint
COPY health_server.py /usr/local/bin/limo-sip-health
COPY templates/ /opt/limo-sip/templates/

RUN sed -i 's/\r$//' /usr/local/bin/limo-sip-entrypoint \
    && chmod 0755 /usr/local/bin/limo-sip-entrypoint /usr/local/bin/limo-sip-health

EXPOSE 5060/tcp
EXPOSE 5060/udp
EXPOSE 10000-10100/udp
EXPOSE 8080/tcp

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD asterisk -rx "pjsip show registrations" | grep -q "Registered" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/limo-sip-entrypoint"]
