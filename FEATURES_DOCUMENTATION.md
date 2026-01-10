# Vesta Features Documentation

## Copy to Clipboard

### Overview
Every message (both user messages and AI responses) now has a copy button that appears on hover.

### Usage
1. Hover over any message bubble
2. Click the copy icon (📋) in the top-right corner
3. The icon changes to a checkmark (✓) for 2 seconds to confirm the copy

### Technical Details
- Uses the browser's native Clipboard API (`navigator.clipboard.writeText()`)
- Works for both plain text user messages and markdown-formatted AI responses
- Copies the raw text content (strips markdown formatting)
- Button is disabled while AI response is streaming

### UX Considerations
- Copy button only appears on hover to maintain clean interface
- Visual feedback (check icon) confirms successful copy
- Graceful error handling if clipboard access is denied

---

## File Upload & Processing

### Overview
Users can now attach files to their messages. Vesta will extract and analyze the text content from supported file formats.

### Supported File Types
- **PDF** (.pdf) - Extracts text from all pages
- **Word Documents** (.doc, .docx) - Extracts all paragraph text
- **CSV** (.csv) - Converts to markdown table format
- **Excel** (.xlsx, .xls) - Extracts up to 100 rows per sheet as markdown tables
- **Plain Text** (.txt) - Reads raw content

### File Size Limits
- Maximum file size: **10MB per file**
- Maximum content: **50,000 characters per file** (to maintain model context limits)
- Multiple files can be attached to a single message

### Usage

#### Frontend
1. Click the paperclip (📎) button in the chat input area
2. Select one or more files from your computer
3. Attached files appear as chips above the input area
4. Click the X on any chip to remove a file before sending
5. Add an optional message to provide context
6. Click send to upload and process files

#### File Processing Flow
```
User selects files
    ↓
Files displayed as chips
    ↓
User clicks Send
    ↓
Frontend uploads to /upload endpoint
    ↓
Backend extracts text content
    ↓
Content included in message context
    ↓
AI processes message + file contents
```

### Backend Implementation

#### `/upload` Endpoint
- **Method**: POST
- **Content-Type**: multipart/form-data
- **Parameters**: `files` (List[UploadFile])
- **Response**: JSON with extracted content

**Response Format:**
```json
{
  "files": [
    {
      "filename": "report.pdf",
      "content": "Extracted text content...",
      "size": 1024000
    },
    {
      "filename": "data.csv",
      "content": "| Column1 | Column2 |\n| --- | --- |\n| Data1 | Data2 |",
      "size": 512
    }
  ]
}
```

**Error Handling:**
```json
{
  "files": [
    {
      "filename": "corrupted.pdf",
      "error": "Error extracting PDF: Invalid file format"
    }
  ]
}
```

### Text Extraction Details

#### PDF Extraction (`extract_pdf_text`)
- Uses PyPDF2 library
- Iterates through all pages
- Extracts text content preserving structure
- Handles encrypted PDFs with empty password

#### Word Document Extraction (`extract_docx_text`)
- Uses python-docx library
- Extracts all paragraph text
- Preserves paragraph breaks with newlines
- Supports both .doc and .docx formats (though .doc may have limited support)

#### CSV Extraction (`extract_csv_text`)
- Converts to markdown table format
- First row treated as headers
- Adds separator row for markdown compatibility
- Preserves cell data with proper escaping

#### Excel Extraction (`extract_excel_text`)
- Uses openpyxl library
- Processes all sheets in workbook
- Limits to 100 rows per sheet (performance consideration)
- Formats each sheet as markdown table
- Includes sheet names as headers

#### Plain Text Extraction
- Direct UTF-8 decoding
- Error handling for encoding issues (uses 'ignore' strategy)

### VESTA Compliance

The file upload feature maintains VESTA compliance:

✅ **Session-Scoped Only**
- Files are processed immediately upon upload
- Extracted text is included in conversation context
- No files are stored on disk beyond processing time
- Content cleared when chat is cleared

✅ **No Persistence**
- Files are read into memory only
- Text extraction happens in real-time
- No database or file system storage
- Memory cleared after response generation

✅ **Auditability**
- File uploads logged (filename, size)
- Extraction errors logged
- No sensitive content logged (VESTA compliance)

✅ **Privacy**
- Files never written to disk
- Content exists only in session memory
- Cleared on session boundary

### Security Considerations

1. **File Type Validation**
   - Only allowed extensions accepted
   - Client-side filtering with server-side verification
   - Graceful error messages for unsupported types

2. **File Size Limits**
   - 10MB maximum per file
   - 50k character limit per extracted content
   - Prevents memory exhaustion attacks

3. **Error Handling**
   - Malformed files return descriptive errors
   - Processing failures don't crash the server
   - User-friendly error messages

4. **Content Sanitization**
   - Text extraction only (no executable content)
   - Safe handling of encoding errors
   - No shell command execution

### Dependencies

**Python Backend:**
```
PyPDF2>=3.0.0         # PDF processing
python-docx>=1.1.0    # Word document processing
openpyxl>=3.1.0       # Excel file processing
python-multipart>=0.0.9  # FastAPI file upload support
```

**Frontend:**
- No additional dependencies (uses native browser APIs)

### Error Messages

| Error | Cause | Resolution |
|-------|-------|------------|
| "Some files were skipped" | Unsupported file type | Use only supported formats |
| "File too large (max 10MB)" | File exceeds size limit | Split file or compress |
| "Failed to upload files" | Network error | Check backend connection |
| "[PDF processing unavailable]" | PyPDF2 not installed | Install backend dependencies |
| "[DOCX processing unavailable]" | python-docx not installed | Install backend dependencies |

### Known Limitations

1. **PDF Limitations**
   - Text must be selectable (not scanned images)
   - Some complex PDFs with unusual formatting may have extraction issues
   - Encrypted PDFs may fail to extract

2. **Word Document Limitations**
   - Tables are extracted as plain text (formatting lost)
   - Images and diagrams not extracted
   - Comments and tracked changes ignored

3. **Excel Limitations**
   - Limited to 100 rows per sheet (performance)
   - Formulas show results, not formulas
   - Charts and images not extracted
   - Formatting (colors, fonts) not preserved

4. **CSV Limitations**
   - Assumes first row is headers
   - Complex quoting may cause parsing issues
   - Very wide tables may be truncated in display

### Future Enhancements

Potential improvements (not yet implemented):

- [ ] Image text extraction (OCR) for scanned PDFs
- [ ] Drag-and-drop file upload
- [ ] File preview before sending
- [ ] Support for additional formats (markdown, JSON, XML)
- [ ] Batch file processing optimization
- [ ] Progress indicators for large files
- [ ] File content search within conversation

### Testing Recommendations

**Test Cases:**
1. Upload single file of each supported type
2. Upload multiple files simultaneously
3. Upload file exceeding size limit
4. Upload unsupported file type
5. Remove file before sending
6. Upload file with special characters in name
7. Upload empty file
8. Upload corrupted file
9. Test with slow network connection
10. Test copy functionality on file-enriched messages

**Expected Behaviors:**
- Files extract successfully and content appears in message
- AI responses reference file content appropriately
- File chips display correctly with names and sizes
- Remove button works for each file
- Error messages clear and actionable
- Session clearing removes all file context

---

## Installation

### Backend Setup

1. Install new dependencies:
```bash
cd vesta-backend
pip install -r requirements.txt
```

2. Restart the backend server:
```bash
uvicorn main:app --reload
```

### Frontend Setup

No additional installation needed - uses existing dependencies.

### Verification

1. Test copy functionality: Hover over any message and click copy
2. Test file upload: Click paperclip icon and select a test file
3. Check backend logs for upload processing confirmation

---

## Troubleshooting

### Copy Not Working
- **Issue**: Copy button doesn't appear
- **Solution**: Check browser supports Clipboard API (Chrome, Firefox, Safari, Edge all supported)

- **Issue**: Copy fails silently
- **Solution**: Browser may require HTTPS for clipboard access (except localhost)

### File Upload Not Working
- **Issue**: Upload button unresponsive
- **Solution**: Check backend is running on http://localhost:8000

- **Issue**: "Failed to upload files" error
- **Solution**: Verify backend dependencies installed, check console for detailed errors

- **Issue**: File processing slow
- **Solution**: Large PDFs can take time; consider splitting files or reducing quality

### Backend Errors
- **Issue**: "PyPDF2 not installed" in response
- **Solution**: Run `pip install PyPDF2>=3.0.0`

- **Issue**: "python-docx not installed"
- **Solution**: Run `pip install python-docx>=1.1.0`

- **Issue**: File upload fails with 413 error
- **Solution**: File too large (>10MB), compress or split file
