"""Register the existing nextchat container in BaoTa's Docker site list.

This script calls BaoTa's internal SitesManage.create_site via the btserver BTPanel
python module so the entry shows up under  /docker/dockersite  on the panel.

It does not create a brand-new container or change ports.  It only:
  * inserts a row into docker_sites (and docker_domain) under the project chat.dyxcloud.com
  * writes the BaoTa-managed nginx vhost for the domain, reverse-proxying to
    http://127.0.0.1:3000  (where the existing nextchat container already listens)
  * reuses the existing container_id so the BaoTa "container" tab links back
    to the running nextchat container.

After running, log in to BaoTa and visit  https://<panel>/docker/dockersite
to see the website listed.
"""

import os
import sys
import json

PANEL = "/www/server/panel"
sys.path.insert(0, PANEL)
sys.path.insert(0, os.path.join(PANEL, "class"))
sys.path.insert(0, os.path.join(PANEL, "mod"))

import public  # noqa: E402

# We don't need a real HTTP request; dict_obj gives us attribute access used by
# the create_site/get APIs throughout the codebase.
get = public.dict_obj()

# ----- user-tunable -----------------------------------------------------------
DOMAIN = "chat.dyxcloud.com"
EXTRA_DOMAIN = ""
PROXY_PASS = "http://127.0.0.1:3000"
PROXY_HOST = "$http_host"
REMARK = "NextChat (docker)"
# Container that should be linked.  Must be a real running container on this host.
CONTAINER_NAME = "nextchat"
# Site name on the panel; usually same as DOMAIN, but no dots.
SITE_NAME = DOMAIN
# -----------------------------------------------------------------------------


def _container_id(name: str) -> str:
    import subprocess
    out = subprocess.check_output(
        ["docker", "inspect", name, "--format", "{{.Id}}"],
        text=True,
    ).strip()
    if not out:
        raise SystemExit(f"container {name!r} not found")
    return out


def main() -> None:
    from mod.project.docker.sites.sitesManage import SitesManage

    cid = _container_id(CONTAINER_NAME)

    get.domains = DOMAIN + (("\n" + EXTRA_DOMAIN) if EXTRA_DOMAIN else "")
    get.remark = REMARK
    get.type = "app"           # type: app (no PHP/Java/Go/Python runtime hooked)
    get.name = CONTAINER_NAME  # service name stored in service_info
    get.port = "3000"          # the application listens on 3000 inside container
    get.proxy_pass = PROXY_PASS
    get.proxy_host = PROXY_HOST
    get.container_id = cid

    sm = SitesManage()
    result = sm.create_site(get)
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    main()
