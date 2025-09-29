import { BinanceTrader } from './src/bot.js';

const config = {
    asset: 'FF',
    base: 'USDT',
    clearanceSell: 1.02,
    clearanceBuy: 0.96,
    tickInterval: 5000,
    volume: 10,
};

const binanceTrader = new BinanceTrader(config);
binanceTrader.tick();
