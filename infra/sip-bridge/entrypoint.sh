#!/bin/sh
set -eu

required_vars="PUBLIC_IPV4 VONO_USERNAME VONO_PASSWORD EL_SIP_USERNAME EL_SIP_PASSWORD"

for variable_name in $required_vars; do
  eval "variable_value=\${$variable_name:-}"
  if [ -z "$variable_value" ]; then
    echo "Variavel obrigatoria ausente: $variable_name" >&2
    exit 1
  fi
done

: "${VONO_DOMAIN:=vono2.me}"
: "${VONO_CALLER_ID:=1154444114}"
: "${EL_AGENT_NUMBER:=+551154444114}"

export PUBLIC_IPV4 VONO_USERNAME VONO_PASSWORD VONO_DOMAIN VONO_CALLER_ID
export EL_SIP_USERNAME EL_SIP_PASSWORD EL_AGENT_NUMBER

rendered_files="pjsip.conf extensions.conf rtp.conf logger.conf modules.conf"
template_variables='${PUBLIC_IPV4} ${VONO_USERNAME} ${VONO_PASSWORD} ${VONO_DOMAIN} ${VONO_CALLER_ID} ${EL_SIP_USERNAME} ${EL_SIP_PASSWORD} ${EL_AGENT_NUMBER}'

for rendered_file in $rendered_files; do
  envsubst "$template_variables" \
    < "/opt/limo-sip/templates/${rendered_file}.tmpl" \
    > "/etc/asterisk/${rendered_file}"
done

chmod 0600 /etc/asterisk/pjsip.conf /etc/asterisk/extensions.conf

echo "Iniciando a ponte SIP do Limo (credenciais ocultas)."
python3 /usr/local/bin/limo-sip-health &
exec asterisk -f -vvv
