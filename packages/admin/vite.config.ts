import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const adminPort = Number(env.EDGEBASE_ADMIN_PORT || '5180');
    const adminBasePath = (() => {
        const raw = env.EDGEBASE_ADMIN_BASE_PATH || env.VITE_EDGEBASE_ADMIN_BASE_PATH || '/admin';
        if (raw === '/') return '/';
        const normalized = raw.startsWith('/') ? raw : `/${raw}`;
        return normalized.replace(/\/+$/, '') || '/';
    })();
    const apiOrigin =
        env.VITE_EDGEBASE_ADMIN_API_ORIGIN
        || env.EDGEBASE_ADMIN_API_ORIGIN
        || `http://localhost:${env.EDGEBASE_SERVER_PORT || '8787'}`;

    return {
        plugins: [sveltekit(), svelteTesting()],
        server: {
            open: adminBasePath,
            port: adminPort,
            proxy: {
                '/admin/api': {
                    target: apiOrigin,
                    changeOrigin: true,
                },
                '/openapi.json': {
                    target: apiOrigin,
                    changeOrigin: true,
                },
            },
        },
        test: {
            environment: 'jsdom',
            setupFiles: ['./src/test/setup.ts'],
            include: ['src/**/*.test.ts'],
        },
    };
});
