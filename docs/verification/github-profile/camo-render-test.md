# Camo / GitHub rendering probe (Issue #1212 verification)

This file exists to verify, on github.com itself, whether the README
markup planned for the profile survives GitHub's HTML pipeline and
Camo proxying. It is not part of the public profile. The blocks below
mirror `.tmp/rebuildup-profile/README.md` markup exactly.

## Viewport switching — the real README construct

<picture>
<source media="(max-width: 767px)" srcset="https://rebuildup.dev/api/v1/github-profile/now?layout=mobile">
<img src="https://rebuildup.dev/api/v1/github-profile/now" width="800" alt="Now — GitHub stats, recent activity, declared focus and Discord presence, with observation times">
</picture>

<picture>
<source media="(max-width: 767px)" srcset="https://rebuildup.dev/api/v1/github-profile/activity?layout=mobile">
<img src="https://rebuildup.dev/api/v1/github-profile/activity" width="800" alt="GitHub activity — commits by repository and recent public events, times in JST">
</picture>

## Theme switching — skill-icon construct

<picture><source media="(prefers-color-scheme: dark)" srcset="https://rebuildup.dev/github-profile/skills/python-dark.svg"><img src="https://rebuildup.dev/github-profile/skills/python-light.svg" height="40" alt="python"></picture>

## Animated WebP + plain SVG

<img src="https://rebuildup.dev/github-profile/showcase.webp" width="800" alt="Selected work showcase">
<img src="https://rebuildup.dev/api/v1/github-profile/presence" width="460" alt="Discord presence">
