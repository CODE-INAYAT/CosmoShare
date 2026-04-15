import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          // API routes (app router + pages router)
          '/api/',

          // Authenticated dashboards — no public content to index
          '/admin/',
          '/student/',

          // Next.js internal build assets & data
          '/_next/',

          // Dev / preview files in public
          '/preview_logo.html',
        ],
      },
    ],
    sitemap: 'https://cosmoshare.pages.dev/sitemap.xml',
  }
}
