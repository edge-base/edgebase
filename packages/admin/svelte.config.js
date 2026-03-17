import adapter from '@sveltejs/adapter-static';

function normalizeBasePath(value) {
    if (!value || value === '/') return '';
    const normalized = value.startsWith('/') ? value : `/${value}`;
    return normalized.replace(/\/+$/, '');
}

const adminBasePath = normalizeBasePath(process.env.EDGEBASE_ADMIN_BASE_PATH ?? '/admin');

/** @type {import('@sveltejs/kit').Config} */
const config = {
    kit: {
        adapter: adapter({
            pages: 'build',
            assets: 'build',
            fallback: 'index.html',
            precompress: false,
            strict: true
        }),
        paths: {
            base: adminBasePath
        }
    }
};

export default config;
