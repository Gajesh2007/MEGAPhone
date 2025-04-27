import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    basicSsl({
      /** name of certification */
      name: 'MegaPHONE',
      /** custom trust domains */
    }),
  ],
  server: {
    host: true
  }
})
