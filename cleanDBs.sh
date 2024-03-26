#!/bin/bash
NEURANETDIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

rm -rf $NEURANETDIR/backend/apps/neuranet/cms
mkdir $NEURANETDIR/backend/apps/neuranet/cms
rm -rf $NEURANETDIR/backend/apps/neuranet/db/ai_db
mkdir $NEURANETDIR/backend/apps/neuranet/db/ai_db

echo Done.
