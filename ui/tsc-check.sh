#!/usr/bin/env bash
cd /mnt/c/Users/user/git/kubegui/ui
npx tsc -p tsconfig.app.json --noEmit > /mnt/c/Users/user/git/kubegui/ui/.tsc2.log 2>&1
echo "EXIT=$?" >> /mnt/c/Users/user/git/kubegui/ui/.tsc2.log