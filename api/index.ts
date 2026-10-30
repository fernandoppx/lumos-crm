import express from 'express';
import dotenv from 'dotenv';
import { apiRouter } from '../src/server/apiRouter.ts';

// Garante que variáveis de ambiente estejam acessíveis
dotenv.config();

const app = express();

// Parsing seguro de requisições JSON e URL encoded para webhooks e chamadas internas
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Monta o apiRouter tanto sob /api quanto na raiz
// Isso assegura compatibilidade total quer a Vercel preserve o prefixo /api na chamada à Serverless Function ou o remova na reescrita.
app.use('/api', apiRouter);
app.use(apiRouter);

export default app;
