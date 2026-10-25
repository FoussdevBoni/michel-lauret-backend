import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';
import mongoose from 'mongoose';
import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import User from '../src/models/User';

let hidden = false;
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!hidden) stdout.write(chunk);
    callback();
  },
});
const terminal = createInterface({
  input: stdin,
  output,
  terminal: Boolean(stdin.isTTY),
});
try {
  if (!process.env.MONGO_URI) throw new Error('Renseignez MONGO_URI dans backend/.env.');
  const email = z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .parse(await terminal.question('Email administrateur : '));
  const username = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .parse(await terminal.question('Nom : '));
  stdout.write('Mot de passe (12 caractères minimum, saisie masquée) : ');
  hidden = true;
  const password = z
    .string()
    .min(12)
    .max(200)
    .parse(await terminal.question(''));
  hidden = false;
  stdout.write('\n');
  await mongoose.connect(process.env.MONGO_URI);
  await User.init();
  if (await User.exists({ email }))
    throw new Error('Cet email existe déjà. Aucun compte n’a été modifié.');
  await User.create({
    email,
    username,
    password,
    role: 'admin',
    status: 'active',
    isVerified: true,
  });
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    const line = `JWT_SECRET=${randomBytes(48).toString('hex')}`;
    let contents = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
    contents = /^\s*JWT_SECRET\s*=/m.test(contents)
      ? contents.replace(/^\s*JWT_SECRET\s*=.*$/gm, line)
      : `${contents}\n${line}\n`;
    writeFileSync('.env', contents);
    console.log('Secret de session configuré dans .env. Redémarrez le backend.');
  }
  console.log(
    'Compte administrateur créé. Vous pouvez vous connecter dans l’application.',
  );
} catch (error) {
  hidden = false;
  console.error(error instanceof Error ? error.message : 'Création impossible.');
  process.exitCode = 1;
} finally {
  terminal.close();
  await mongoose.disconnect();
}
