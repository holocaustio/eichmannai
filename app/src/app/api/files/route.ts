import { NextRequest, NextResponse } from 'next/server';
import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';

const OCR_DIR = join(process.cwd(), '..', 'downloads', 'pdf', 'OCR_clean');

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileName = searchParams.get('file');

  try {
    if (fileName) {
      // Return specific file content
      const filePath = join(OCR_DIR, fileName);
      const content = await readFile(filePath, 'utf-8');
      const fileStat = await stat(filePath);
      
      return NextResponse.json({
        name: fileName,
        content: content,
        size: fileStat.size,
        lines: content.split('\n').length,
      });
    } else {
      // Return list of available files
      const files = await readdir(OCR_DIR);
      const txtFiles = files.filter(f => f.endsWith('.txt'));
      
      const fileList = await Promise.all(
        txtFiles.map(async (file) => {
          const filePath = join(OCR_DIR, file);
          const fileStat = await stat(filePath);
          
          // Extract session info from filename
          let sessions: string[] = [];
          let description = '';
          
          if (file.startsWith('Vol1_p114')) {
            sessions = ['1-14'];
            description = 'Volume 1, Sessions 1-14';
          } else if (file.startsWith('Vol1_p15291')) {
            sessions = ['15-29'];
            description = 'Volume 1, Sessions 15-29';
          } else if (file.startsWith('vol1_part3')) {
            sessions = ['30-40'];
            description = 'Volume 1, Sessions 30-40';
          } else if (file.startsWith('Vol2_p4155')) {
            sessions = ['41-54'];
            description = 'Volume 2, Sessions 41-54';
          } else if (file.startsWith('Vol2_p5564')) {
            sessions = ['55-64'];
            description = 'Volume 2, Sessions 55-64';
          } else if (file.startsWith('Vol2_p6575')) {
            sessions = ['65-75'];
            description = 'Volume 2, Sessions 65-75';
          } else if (file.startsWith('vol3_p7689')) {
            sessions = ['76-89'];
            description = 'Volume 3, Sessions 76-89';
          } else if (file.startsWith('vol3_p90100')) {
            sessions = ['90-100'];
            description = 'Volume 3, Sessions 90-100';
          } else if (file.startsWith('vol3_p101111')) {
            sessions = ['101-111'];
            description = 'Volume 3, Sessions 101-111';
          } else if (file.startsWith('vol3_p112121')) {
            sessions = ['112-121'];
            description = 'Volume 3, Sessions 112-121';
          } else if (file.includes('summary')) {
            description = 'Summary document';
          } else if (file.includes('claims')) {
            description = 'Claims and accusations';
          } else if (file.includes('judgement')) {
            description = 'Court judgement';
          } else {
            description = file.replace('.txt', '').replace(/_/g, ' ');
          }
          
          return {
            name: file,
            size: fileStat.size,
            sizeFormatted: formatBytes(fileStat.size),
            sessions,
            description,
          };
        })
      );
      
      // Sort by name
      fileList.sort((a, b) => a.name.localeCompare(b.name));
      
      return NextResponse.json({ files: fileList });
    }
  } catch (error) {
    console.error('Error reading files:', error);
    return NextResponse.json({ error: 'Failed to read files' }, { status: 500 });
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
