import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { 
  LineChart, Line, AreaChart, Area, BarChart, Bar, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import axios from 'axios';
import io from 'socket.io-client';
import { 
  Dashboard, 
  TrendingUp, 
  Settings, 
  BarChart2, 
  PieChart as PieChartIcon, 
  Activity, 
  Clock, 
  AlertTriangle
} from 'lucide-react';

// Replace with your actual API URL or use environment variable
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000/api';
const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:3000';

// Initialize socket connection
const socket = io(SOCKET_URL);

function App() {
  return (
    <Router>
      <div className="flex h-screen bg-gray-100">
        {/* Sidebar */}
        <Sidebar />
        
        {/* Main content */}
        <div className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/tokens" element={<Tokens />} />
            <Route path="/instances" element={<Instances />} />
            <Route path="/strategies" element={<Strategies />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

function Sidebar() {
  return (
    <div className="w-64 bg-indigo-900 text-white p-6">
      <h1 className="text-xl font-bold mb-8">Memecoin Trading Bot</h1>
      <nav>
        <SidebarLink to="/" icon={<Dashboard />} label="Overview" />
        <SidebarLink to="/tokens" icon={<TrendingUp />} label="Tokens" />
        <SidebarLink to="/instances" icon={<Activity />} label="Instances" />
        <SidebarLink to="/strategies" icon={<BarChart2 />} label="Strategies" />
        <SidebarLink to="/settings" icon={<Settings />} label="Settings" />
      </nav>
      <div className="mt-auto pt-8">
        <StatusIndicator />
      </div>
    </div>
  );
}

function SidebarLink({ to, icon, label }) {
  return (
    <Link to={to} className="flex items-center py-3 px-4 rounded hover:bg-indigo-800 transition-colors">
      <span className="mr-3">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}

function StatusIndicator() {
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    axios.get(`${API_URL}/health`)
      .then(() => setStatus('connected'))
      .catch(() => setStatus('error'));
    
    socket.on('connect', () => setStatus('connected'));
    socket.on('disconnect', () => setStatus('disconnected'));
    socket.on('connect_error', () => setStatus('error'));
    
    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
    };
  }, []);

  const getStatusColor = () => {
    switch (status) {
      case 'connected': return 'bg-green-500';
      case 'disconnected': return 'bg-yellow-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-blue-500';
    }
  };

  return (
    <div className="flex items-center text-sm">
      <div className={`h-3 w-3 rounded-full mr-2 ${getStatusColor()}`}></div>
      <span className="capitalize">{status}</span>
    </div>
  );
}

function Overview() {
  const [summaryData, setSummaryData] = useState(null);
  const [recentTrades, setRecentTrades] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        
        // Fetch profit report
        const profitResponse = await axios.get(`${API_URL}/profit-report`);
        
        // Fetch trading data
        const tradesResponse = await axios.get(`${API_URL}/trading-data`);
        
        // Extract summary data from profit report
        setSummaryData(profitResponse.data.summary);
        
        // Extract recent trades from trading data
        const allTrades = [];
        const tokens = tradesResponse.data.tokens || {};
        
        Object.entries(tokens).forEach(([address, token]) => {
          if (token.transactions) {
            token.transactions.forEach(tx => {
              allTrades.push({
                ...tx,
                tokenName: token.tokenName || 'Unknown',
                tokenAddress: address
              });
            });
          }
        });
        
        // Sort by timestamp (most recent first) and take the most recent 10
        const sortedTrades = allTrades
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .slice(0, 10);
        
        setRecentTrades(sortedTrades);
        setIsLoading(false);
      } catch (err) {
        console.error('Error fetching overview data:', err);
        setError(err.message);
        setIsLoading(false);
      }
    };
    
    fetchData();
    
    // Listen for updates via socket.io
    socket.on('file-updated', (data) => {
      if (data.file === 'profit_report.json' || data.file === 'trade_logs.json') {
        fetchData();
      }
    });
    
    return () => {
      socket.off('file-updated');
    };
  }, []);

  if (isLoading) {
    return <div className="p-8 text-center">Loading dashboard data...</div>;
  }

  if (error) {
    return <div className="p-8 text-center text-red-500">Error loading data: {error}</div>;
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Trading Dashboard</h1>
      
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <SummaryCard 
          title="Total P/L" 
          value={summaryData?.totalProfitLoss || 0} 
          suffix="SOL"
          valueType="currency"
          isPositive={summaryData?.totalProfitLoss > 0}
        />
        <SummaryCard 
          title="ROI" 
          value={summaryData?.totalROI || 0} 
          suffix="%"
          valueType="percentage"
          isPositive={summaryData?.totalROI > 0}
        />
        <SummaryCard 
          title="Win Rate" 
          value={summaryData?.winRate || 0} 
          suffix="%"
          valueType="percentage"
          isPositive={true}
        />
        <SummaryCard 
          title="Active Tokens" 
          value={summaryData?.tokenCount || 0} 
          valueType="integer"
          isPositive={true}
        />
      </div>
      
      {/* Performance chart */}
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Performance Over Time</h2>
        <PerformanceChart data={generatePerformanceData(summaryData)} />
      </div>
      
      {/* Recent trades and distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Trades</h2>
          <RecentTradesTable trades={recentTrades} />
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Portfolio Distribution</h2>
          <PortfolioDistribution data={generatePortfolioData(summaryData)} />
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ title, value, suffix = '', valueType = 'number', isPositive = true }) {
  const formattedValue = () => {
    if (valueType === 'currency') {
      return value.toFixed(4);
    } else if (valueType === 'percentage') {
      return value.toFixed(2);
    } else if (valueType === 'integer') {
      return value.toString();
    }
    return value.toString();
  };

  const valueColor = isPositive ? 'text-green-600' : 'text-red-600';
  const bgColor = isPositive ? 'bg-green-100' : 'bg-red-100';
  
  // Only apply color to numeric values that can be positive/negative
  const shouldApplyColor = valueType === 'currency' || valueType === 'percentage';

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-sm font-medium text-gray-500 mb-2">{title}</h3>
      <div className="flex items-center">
        <span className={`text-2xl font-bold ${shouldApplyColor ? valueColor : ''}`}>
          {shouldApplyColor && isPositive ? '+' : ''}
          {formattedValue()}
        </span>
        {suffix && <span className="ml-1 text-gray-500">{suffix}</span>}
      </div>
      {valueType !== 'integer' && (
        <div className={`mt-2 inline-block px-2 py-1 rounded ${bgColor} ${valueColor} text-xs font-medium`}>
          {isPositive ? '▲' : '▼'} {Math.abs(value).toFixed(2)}%
        </div>
      )}
    </div>
  );
}

function PerformanceChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="colorPnl" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8}/>
            <stop offset="95%" stopColor="#8884d8" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <XAxis dataKey="name" />
        <YAxis />
        <CartesianGrid strokeDasharray="3 3" />
        <Tooltip />
        <Area type="monotone" dataKey="pnl" stroke="#8884d8" fillOpacity={1} fill="url(#colorPnl)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function RecentTradesTable({ trades }) {
  if (!trades || trades.length === 0) {
    return <div className="text-center text-gray-500">No recent trades found</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Token</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {trades.map((trade, index) => (
            <tr key={index}>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {new Date(trade.timestamp).toLocaleString()}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                {trade.tokenName}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  trade.type.toLowerCase() === 'buy' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                }`}>
                  {trade.type}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {trade.amount?.toFixed(2) || '0'}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {trade.pricePerToken?.toFixed(8) || '0'} SOL
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PortfolioDistribution({ data }) {
  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];
  
  if (!data || data.length === 0) {
    return <div className="text-center text-gray-500">No portfolio data available</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={renderCustomizedLabel}
          outerRadius={100}
          fill="#8884d8"
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

// Helper function for rendering pie chart labels
const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text x={x} y={y} fill="white" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

// Helper functions to generate mock data when real data isn't available yet
function generatePerformanceData(summary) {
  // If we have real data, we could use it here
  // For now, generate some sample data
  return Array.from({ length: 30 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (29 - i));
    
    return {
      name: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      pnl: Math.random() * 10 * (Math.random() > 0.3 ? 1 : -1) + (i * 0.2),
    };
  });
}

function generatePortfolioData(summary) {
  // Mock data for portfolio distribution
  return [
    { name: 'Token A', value: 40 },
    { name: 'Token B', value: 30 },
    { name: 'Token C', value: 15 },
    { name: 'Token D', value: 10 },
    { name: 'Others', value: 5 },
  ];
}

// Placeholder components for other routes
function Tokens() {
  return <div className="p-8"><h1 className="text-2xl font-bold">Tokens</h1></div>;
}

function Instances() {
  return <div className="p-8"><h1 className="text-2xl font-bold">Instances</h1></div>;
}

function Strategies() {
  return <div className="p-8"><h1 className="text-2xl font-bold">Strategies</h1></div>;
}

function Settings() {
  return <div className="p-8"><h1 className="text-2xl font-bold">Settings</h1></div>;
}

export default App;