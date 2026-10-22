'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useState } from 'react'
import { TorrentClientProvider } from '@/components/torrent-client'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() =>
    new QueryClient({
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: false,
          retry: 1,
        },
      },
    })
  )

  return (
    <QueryClientProvider client={queryClient}>
      {/* R-21: working light/dark toggle. Default to system preference. */}
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        {/* Client-side WebTorrent. No server needed. */}
        <TorrentClientProvider>
          {children}
        </TorrentClientProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
