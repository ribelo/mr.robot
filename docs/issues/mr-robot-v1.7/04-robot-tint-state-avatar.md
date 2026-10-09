# 04: Robot-coloured message tint and state avatar

**Parent:** mr-robot-v1.7 (../mr-robot-v1.7.md) — stories ap-yzs4, ap-bxt2

**What to build:** A Robot's replies sit on a background mixed from its colour and the theme surface (around 10–14% in dark, 8–10% in light) with theme text colour; messages from other Robots use the sender's colour. The avatar animates per fleet state (pulse working, ring waiting for you, muted mark blocked) with CSS only and respects reduced motion.

**Blocked by:** 01 Theme tokens

**Status:** done

- [x] Computed background of a Robot message is a color-mix of its avatarColor and the surface in both themes (test)
- [x] Avatar gets a state class per fleet state in the list and the header; reduced motion disables animation
