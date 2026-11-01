#!/usr/bin/env bash
# Nightly backup of /opt/akashwani/deploy/data to /var/backups/akashwani (keeps 14). Install:  (crontab -l; echo "0 2 * * * /opt/akashwani/deploy/backup.sh") | crontab -
set -e; D=/var/backups/akashwani; mkdir -p "$D"
docker run --rm -v akashwani_data:/data -v "$D":/out alpine sh -c "cd /data && tar czf /out/akashwani-$(date +%F).tgz ." 2>/dev/null || tar czf "$D/akashwani-$(date +%F).tgz" -C /opt/akashwani/deploy/data .
ls -1t "$D"/akashwani-*.tgz | tail -n +15 | xargs -r rm -f
