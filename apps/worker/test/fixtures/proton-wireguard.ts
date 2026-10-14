/**
 * A Proton VPN WireGuard configuration as Proton's download page writes it (Downloads → WireGuard
 * configuration), with fake keys. Proton adds no PresharedKey; this one carries one so a test can
 * check that it stays sealed too.
 */
export const PROTON_PRIVATE_KEY = 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk='
export const PROTON_PRESHARED_KEY = 'FpCyhws9cxwWoV4xELtfJvjJN+zQVRPISllRWgeopVE='

export const PROTON_WIREGUARD = `[Interface]
# Key for mr-robot
# Bouncing = 7
# NetShield = 1
# Moderate NAT = off
# NAT-PMP (Port Forwarding) = off
# VPN Accelerator = on
PrivateKey = ${PROTON_PRIVATE_KEY}
Address = 10.2.0.2/32
DNS = 10.2.0.1

[Peer]
# PL#45
PublicKey = HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw=
PresharedKey = ${PROTON_PRESHARED_KEY}
AllowedIPs = 0.0.0.0/0
Endpoint = 185.246.208.66:51820
`

/** The same server in Proton's free tier, named the way its file is ("wg-PL-FREE-12.conf"). */
export const PROTON_FREE_WIREGUARD = PROTON_WIREGUARD.replace('# PL#45', '# pl-free-12').replace('185.246.208.66', 'node-pl-12.protonvpn.net')
