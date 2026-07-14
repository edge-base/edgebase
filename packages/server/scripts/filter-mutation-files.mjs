#!/usr/bin/env node

import { filterMutationTargets } from '../mutation-targets.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
process.stdout.write(filterMutationTargets(input).join(','));
