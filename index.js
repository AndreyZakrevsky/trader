import { BinanceTrader } from './src/bot.js';

const config = {
    asset: 'MIRA',
    base: 'USDT',
    clearanceSell: 1.02,
    clearanceBuy: 0.96,
    tickInterval: 8000,
    maxOrderByBaseBalance: 10,
    volume: 10,
};

const binanceTrader = new BinanceTrader(config);
binanceTrader.tick();
