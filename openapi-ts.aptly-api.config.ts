import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
    // input: 'https://www.aptly.info/swagger/aptly_1.6.2.json',
    input: 'src/aptly/api-spec/openapi.json',
    output: 'src/aptly/api-client'
});