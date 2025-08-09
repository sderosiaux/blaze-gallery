"use client";

import { useState, useEffect, useCallback } from 'react';
import { Activity, BarChart3, Clock, Database, Download, Eye, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import AppLayout from '@/components/AppLayout';
import { S3AuditResponse, S3AuditStats, PerformanceMetrics, OperationAnalysis, S3AuditLog } from '@/types/audit';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';

export default function AuditDashboard() {
  const [stats, setStats] = useState<S3AuditStats | null>(null);
  const [recentLogs, setRecentLogs] = useState<S3AuditLog[]>([]);
  const [performanceMetrics, setPerformanceMetrics] = useState<PerformanceMetrics[]>([]);
  const [operationAnalysis, setOperationAnalysis] = useState<OperationAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'1h' | '6h' | '24h' | '7d'>('24h');
  const [pageSize, setPageSize] = useState<20 | 100 | 500>(20);

  const loadDashboardData = useCallback(async () => {
    try {
      const now = new Date();
      const timeRanges = {
        '1h': 1 * 60 * 60 * 1000,
        '6h': 6 * 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000
      };
      
      const startDate = new Date(now.getTime() - timeRanges[timeRange]).toISOString();
      const endDate = now.toISOString();

      // Load all data in parallel
      const [statsResponse, logsResponse, performanceResponse, operationsResponse] = await Promise.all([
        fetch(`/api/audit/stats?start_date=${startDate}&end_date=${endDate}`),
        fetch(`/api/audit/logs?start_date=${startDate}&end_date=${endDate}&limit=${pageSize}&sort_by=timestamp&sort_order=desc`),
        fetch(`/api/audit/performance?start_date=${startDate}&end_date=${endDate}&group_by=5min`),
        fetch(`/api/audit/operations?start_date=${startDate}&end_date=${endDate}`)
      ]);

      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        setStats(statsData.data);
      }

      if (logsResponse.ok) {
        const logsData: { data: S3AuditResponse } = await logsResponse.json();
        setRecentLogs(logsData.data.logs);
      }

      if (performanceResponse.ok) {
        const performanceData = await performanceResponse.json();
        setPerformanceMetrics(performanceData.data.metrics);
      }

      if (operationsResponse.ok) {
        const operationsData = await operationsResponse.json();
        setOperationAnalysis(operationsData.data.operations);
      }

    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, [timeRange, pageSize]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getStatusColor = (statusCode: number) => {
    if (statusCode >= 200 && statusCode < 300) return 'text-green-600';
    if (statusCode >= 300 && statusCode < 400) return 'text-yellow-600';
    if (statusCode >= 400 && statusCode < 500) return 'text-red-600';
    return 'text-red-800';
  };

  const getStatusIcon = (statusCode: number) => {
    if (statusCode >= 200 && statusCode < 300) return <CheckCircle className="w-4 h-4 text-green-600" />;
    if (statusCode >= 400) return <XCircle className="w-4 h-4 text-red-600" />;
    return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
  };

  const formatChartTime = (value: string) => {
    const date = new Date(value);
    if (timeRange === '7d') {
      // For 7 days, show date + hour:minute to handle the large number of data points
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + 
             date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      // For shorter ranges, just show hour:minute
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  };

  if (loading) {
    return (
      <AppLayout title="Blaze Gallery">
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Blaze Gallery">
      <div className="space-y-6">
        {/* Header Controls */}
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            <Activity className="w-6 h-6 mr-2" />
            B2 Performance Audit
          </h1>
          
          <div className="flex items-center space-x-4">
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as any)}
              className="border border-gray-300 rounded-lg px-3 py-2"
            >
              <option value="1h">Last Hour</option>
              <option value="6h">Last 6 Hours</option>
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
            </select>
          </div>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <Database className="w-8 h-8 text-blue-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Total Requests</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.total_requests.toLocaleString()}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <Clock className="w-8 h-8 text-green-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Avg Response Time</p>
                  <p className="text-2xl font-bold text-gray-900">{formatDuration(stats.avg_duration_ms)}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <Download className="w-8 h-8 text-purple-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Data Transferred</p>
                  <p className="text-2xl font-bold text-gray-900">{formatBytes(stats.total_bytes_transferred)}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center">
                <AlertTriangle className={`w-8 h-8 ${stats.error_rate > 0.05 ? 'text-red-600' : 'text-green-600'}`} />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Error Rate</p>
                  <p className="text-2xl font-bold text-gray-900">{(stats.error_rate * 100).toFixed(2)}%</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Operation Analysis */}
        {operationAnalysis.length > 0 && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <BarChart3 className="w-5 h-5 mr-2" />
                Operations Analysis
              </h2>
            </div>
            <div className="p-6">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Operation</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Count</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Duration</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">P95 Duration</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Success Rate</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {operationAnalysis.map((op, index) => (
                      <tr key={index}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{op.operation}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{op.count.toLocaleString()}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatDuration(op.avg_duration_ms)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatDuration(op.p95_duration_ms)}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          <span className={`px-2 py-1 text-xs rounded-full ${op.success_rate > 0.95 ? 'bg-green-100 text-green-800' : op.success_rate > 0.9 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                            {(op.success_rate * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatBytes(op.total_bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Recent Logs */}
        {recentLogs.length > 0 && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                  <Eye className="w-5 h-5 mr-2" />
                  Recent Activity
                </h2>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(parseInt(e.target.value) as any)}
                  className="border border-gray-300 rounded-lg px-3 py-1 text-sm"
                  title="Number of entries to show"
                >
                  <option value={20}>20 entries</option>
                  <option value={100}>100 entries</option>
                  <option value={500}>500 entries</option>
                </select>
              </div>
            </div>
            <div className="p-6">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Operation</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Endpoint</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {recentLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            log.operation === 'GetObject' ? 'bg-blue-100 text-blue-800' :
                            log.operation === 'ListObjects' ? 'bg-green-100 text-green-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {log.operation}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <div className="flex items-center">
                            {getStatusIcon(log.status_code)}
                            <span className={`ml-2 ${getStatusColor(log.status_code)}`}>
                              {log.status_code}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatDuration(log.duration_ms)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {log.bytes_transferred ? formatBytes(log.bytes_transferred) : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 truncate max-w-xs">
                          {log.endpoint}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Performance Chart */}
        {performanceMetrics.length > 0 && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <BarChart3 className="w-5 h-5 mr-2" />
                Performance Over Time
              </h2>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Response Time Chart */}
                <div>
                  <h3 className="text-md font-medium text-gray-900 mb-4">Average Response Time</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={performanceMetrics}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="time_period" 
                        tickFormatter={formatChartTime}
                      />
                      <YAxis 
                        tickFormatter={(value) => `${Math.round(value)}ms`}
                      />
                      <Tooltip 
                        labelFormatter={(value) => new Date(value).toLocaleString()}
                        formatter={(value: any) => [`${Math.round(value)}ms`, 'Response Time']}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="avg_response_time" 
                        stroke="#3b82f6" 
                        strokeWidth={2}
                        dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Request Volume Chart */}
                <div>
                  <h3 className="text-md font-medium text-gray-900 mb-4">Request Volume</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={performanceMetrics}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="time_period"
                        tickFormatter={formatChartTime}
                      />
                      <YAxis />
                      <Tooltip 
                        labelFormatter={(value) => new Date(value).toLocaleString()}
                        formatter={(value: any) => [value, 'Requests']}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="request_count" 
                        stroke="#10b981" 
                        fill="#10b981" 
                        fillOpacity={0.6}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Error Rate Chart */}
              {performanceMetrics.some(m => m.error_count > 0) && (
                <div className="mt-6">
                  <h3 className="text-md font-medium text-gray-900 mb-4">Error Rate Over Time</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={performanceMetrics}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="time_period"
                        tickFormatter={formatChartTime}
                      />
                      <YAxis 
                        tickFormatter={(value) => `${value}%`}
                      />
                      <Tooltip 
                        labelFormatter={(value) => new Date(value).toLocaleString()}
                        formatter={(value: any, name: any) => {
                          const metric = performanceMetrics.find(m => m.time_period === value);
                          if (metric) {
                            const errorRate = metric.request_count > 0 ? (metric.error_count / metric.request_count * 100) : 0;
                            return [`${errorRate.toFixed(2)}%`, 'Error Rate'];
                          }
                          return ['0%', 'Error Rate'];
                        }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="error_count"
                        stroke="#ef4444" 
                        strokeWidth={2}
                        dot={{ fill: '#ef4444', strokeWidth: 2, r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Data Transfer Chart */}
              {performanceMetrics.some(m => m.bytes_transferred > 0) && (
                <div className="mt-6">
                  <h3 className="text-md font-medium text-gray-900 mb-4">Data Transfer Over Time</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={performanceMetrics}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="time_period"
                        tickFormatter={formatChartTime}
                      />
                      <YAxis 
                        tickFormatter={(value) => {
                          if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)}GB`;
                          if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)}MB`;
                          if (value >= 1024) return `${(value / 1024).toFixed(1)}KB`;
                          return `${value}B`;
                        }}
                      />
                      <Tooltip 
                        labelFormatter={(value) => new Date(value).toLocaleString()}
                        formatter={(value: any) => {
                          let formatted;
                          if (value >= 1024 * 1024 * 1024) formatted = `${(value / (1024 * 1024 * 1024)).toFixed(2)}GB`;
                          else if (value >= 1024 * 1024) formatted = `${(value / (1024 * 1024)).toFixed(2)}MB`;
                          else if (value >= 1024) formatted = `${(value / 1024).toFixed(2)}KB`;
                          else formatted = `${value}B`;
                          return [formatted, 'Data Transferred'];
                        }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="bytes_transferred" 
                        stroke="#8b5cf6" 
                        fill="#8b5cf6" 
                        fillOpacity={0.6}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}