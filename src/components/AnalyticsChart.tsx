import React from 'react'
import { DailyAnalytics } from '@/lib/storage'
import { formatBytes } from '@/lib/utils'
import NumberFlow from '@number-flow/react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts'

interface AnalyticsChartProps {
  data: DailyAnalytics[]
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload as DailyAnalytics & { displayDate: string }
    return (
      <div className="glass-card border border-white/10 dark:border-white/5 bg-background/80 backdrop-blur-md p-4 rounded-xl shadow-2xl min-w-[200px] animate-in fade-in zoom-in-95 duration-200">
        <p className="text-sm font-semibold mb-3 text-foreground/90 border-b border-border/50 pb-2">{label}</p>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-muted-foreground">
              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              Files
            </span>
            <span className="font-semibold">{data.files} <span className="text-[10px] font-normal text-muted-foreground">({formatBytes(data.totalBytes)})</span></span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-muted-foreground">
              <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
              Links
            </span>
            <span className="font-semibold">{data.links}</span>
          </div>
          <div className="my-1 border-t border-border/30 pt-2 flex items-center justify-between mt-3">
             <span className="text-foreground font-medium">Total Volume</span>
             <span className="font-bold text-primary">{data.totalRequests}</span>
          </div>
        </div>
      </div>
    )
  }
  return null
}

export default function AnalyticsChart({ data }: AnalyticsChartProps) {
  // Format date for display (e.g., "Aug 06")
  const chartData = data.map(d => {
    const dateObj = new Date(d.date)
    return {
      ...d,
      displayDate: dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }
  })

  // Check if we have any actual data across the period
  const hasData = chartData.some(d => d.totalRequests > 0)
  
  // Calculate max to smartly scale Y-axis when data is extremely low
  const maxTotal = Math.max(...chartData.map(d => d.totalRequests))
  const yAxisDomain: any = [0, maxTotal <= 2 ? (maxTotal === 0 ? 5 : maxTotal + 2) : 'auto']

  return (
    <div className="w-full h-80 sm:h-96 mt-6 bg-card border border-border/50 rounded-2xl p-4 sm:p-6 shadow-sm relative overflow-hidden group">
      {/* Decorative ambient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-50 pointer-events-none" />
      
      <div className="flex items-center justify-between mb-6 relative z-10">
        <h3 className="text-lg font-semibold text-foreground/90">Activity Overview</h3>
        <div className="flex items-center gap-4 text-xs font-medium">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">Files</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span className="text-muted-foreground">Links</span>
          </div>
        </div>
      </div>

      <div className="w-full h-[80%] relative z-10">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 0, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="colorFiles" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorLinks" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="currentColor" className="opacity-[0.08]" />
            <XAxis 
              dataKey="displayDate" 
              tickLine={false} 
              axisLine={false} 
              tick={{ fontSize: 12, fill: 'currentColor', opacity: 0.6 }} 
              dy={10}
            />
            <YAxis 
              tickLine={false} 
              axisLine={false} 
              tick={{ fontSize: 12, fill: 'currentColor', opacity: 0.6 }} 
              allowDecimals={false} 
              dx={-10}
              domain={yAxisDomain}
            />
            <RechartsTooltip 
              content={<CustomTooltip />} 
              cursor={{ stroke: 'currentColor', strokeWidth: 1, strokeDasharray: '4 4', opacity: 0.2 }} 
            />
            <Area 
              type="monotone" 
              dataKey="files" 
              stackId="1" 
              stroke="#10b981" 
              strokeWidth={3}
              fill="url(#colorFiles)" 
              dot={{ r: 4, strokeWidth: 2, fill: 'var(--background)', stroke: '#10b981' }}
              activeDot={{ r: 6, strokeWidth: 0, fill: '#10b981', className: 'drop-shadow-[0_0_8px_rgba(16,185,129,0.8)]' }}
            />
            <Area 
              type="monotone" 
              dataKey="links" 
              stackId="1" 
              stroke="#3b82f6" 
              strokeWidth={3}
              fill="url(#colorLinks)" 
              dot={{ r: 4, strokeWidth: 2, fill: 'var(--background)', stroke: '#3b82f6' }}
              activeDot={{ r: 6, strokeWidth: 0, fill: '#3b82f6', className: 'drop-shadow-[0_0_8px_rgba(59,130,246,0.8)]' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Empty State Overlay */}
      {!hasData && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/40 backdrop-blur-[2px] animate-in fade-in duration-500 rounded-2xl">
          <div className="glass-card border border-white/10 dark:border-white/5 bg-background/80 p-6 rounded-2xl shadow-xl flex flex-col items-center text-center max-w-sm">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            </div>
            <h4 className="text-lg font-semibold text-foreground mb-1">Awaiting First Transfer</h4>
            <p className="text-sm text-muted-foreground">Share a file or link from the student dashboard to see your activity populate here.</p>
          </div>
        </div>
      )}
    </div>
  )
}
