import { DailyAnalytics } from '@/lib/storage'

// Toggle this to true to visualize dummy analytics in the Admin Dashboard
export const ENABLE_DUMMY_ANALYTICS = false

export const DUMMY_ANALYTICS_DATA: DailyAnalytics[] = [
  {
    date: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    totalRequests: 210,
    pending: 0,
    printed: 210,
    links: 45,
    files: 165,
    totalBytes: 2140500100, // ~2.1 GB
  },
  {
    date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    totalRequests: 180,
    pending: 2,
    printed: 178,
    links: 30,
    files: 150,
    totalBytes: 1940500100, // ~1.9 GB
  },
  {
    date: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    totalRequests: 320,
    pending: 10,
    printed: 310,
    links: 85,
    files: 235,
    totalBytes: 3840500100, // ~3.8 GB
  },
  {
    date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    totalRequests: 145,
    pending: 5,
    printed: 140,
    links: 40,
    files: 105,
    totalBytes: 1540300200, // ~1.5 GB
  },
  {
    date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    totalRequests: 230,
    pending: 12,
    printed: 218,
    links: 65,
    files: 165,
    totalBytes: 2840500100, // ~2.8 GB
  },
  {
    date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    totalRequests: 89,
    pending: 0,
    printed: 89,
    links: 15,
    files: 74,
    totalBytes: 850300400, // ~850 MB
  },
  {
    date: new Date().toISOString().split('T')[0],
    totalRequests: 178,
    pending: 34,
    printed: 144,
    links: 52,
    files: 126,
    totalBytes: 1940100200, // ~1.9 GB
  }
]
