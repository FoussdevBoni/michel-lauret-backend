// src/models/User.ts
import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';
import { passwordDigest } from '../lib/legacyPassword';
import type { LegacyPassword } from '../types/features/LegacyPassword';

export interface IUser extends Document {
  email?: string;
  role: 'admin' | 'student' | 'teacher';
  provider: 'password' | 'google';
  status: 'active' | 'inactive';
  providerId?: string;
  username: string;
  avatar?: string;
  password?: string;
  passwordFormat?: 'bcrypt' | 'bcrypt-sha256';
  legacyPassword?: LegacyPassword;
  legacyAuthId?: string;
  creatorToken?: string;
  isVerified: boolean;
  lastLogin?: Date;
  passwordResetOtp?: string;
  passwordResetExpires?: Date;
  emailConfirmationOtp?: string;
  emailConfirmationExpires?: Date;
  createdAt: Date;
  updatedAt: Date;

  comparePassword(candidatePassword: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: false,
      unique: true,
      lowercase: true,
      trim: true,
    },

    status: {
      type: String,
      enum: ['active', 'inactive'],
      required: true,
      default: 'active',
    },

    provider: {
      type: String,
      enum: ['password', 'google'],
      required: false,
      default: 'password',
    },

    providerId: {
      type: String,
      required: false,
      index: true,
    },

    role: {
      type: String,
      enum: ['admin', 'student', 'teacher'],
      default: 'admin',
    },

    username: {
      type: String,
      required: true,
    },

    avatar: {
      type: String,
    },

    password: {
      type: String,
      required: false,
      minlength: 6,
      select: false,
    },

    creatorToken: {
      type: String,
    },
    passwordFormat: { type: String, enum: ['bcrypt', 'bcrypt-sha256'] },
    legacyAuthId: { type: String, select: false },
    legacyPassword: {
      type: new Schema(
        {
          hash: { type: String, required: true },
          salt: { type: String, required: true },
          configId: { type: String, required: true },
        },
        { _id: false },
      ),
      select: false,
      default: undefined,
    },

    isVerified: {
      type: Boolean,
      default: false,
    },
    lastLogin: {
      type: Date,
      required: false,
    },
    passwordResetOtp: { type: String, select: false },
    passwordResetExpires: { type: Date },
    emailConfirmationOtp: { type: String, select: false },
    emailConfirmationExpires: { type: Date },
  },
  {
    timestamps: true,
  },
);

userSchema.index(
  { legacyAuthId: 1 },
  {
    unique: true,
    partialFilterExpression: { legacyAuthId: { $type: 'string' } },
  },
);

userSchema.set('toJSON', {
  transform(_document, result) {
    delete result.password;
    delete result.legacyPassword;
    delete result.legacyAuthId;
    delete result.passwordResetOtp;
    delete result.emailConfirmationOtp;
    return result;
  },
});

userSchema.pre<IUser>('save', async function (next) {
  if (this.provider !== 'password') return next();
  if (!this.password) return next();
  if (!this.isModified('password')) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(passwordDigest(this.password), salt);
  this.passwordFormat = 'bcrypt-sha256';
  this.legacyPassword = undefined;
  this.markModified('legacyPassword');

  next();
});

userSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(
    this.passwordFormat === 'bcrypt-sha256'
      ? passwordDigest(candidatePassword)
      : candidatePassword,
    this.password,
  );
};

export default mongoose.model<IUser>('User', userSchema);
