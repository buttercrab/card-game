//! NumPy `.npz` archives: a zip of `.npy` arrays, deflated, which
//! `numpy.load` reads with nothing else installed.
//!
//! Archives are byte-for-byte reproducible: entries have a fixed time
//! stamp and are written in the order given.

use std::fs::File;
use std::io::{self, BufWriter, Read, Seek, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipWriter};

/// Deflate level: 6 (zlib's default) costs about twice level 1 for
/// shards a few percent smaller.
const LEVEL: i64 = 6;

/// A number type `.npy` can hold, written little-endian.
pub trait Element: Copy {
    /// The NumPy type string, such as `<f4`.
    const DESCR: &'static str;

    fn put(self, out: &mut Vec<u8>);
}

macro_rules! element {
    ($t:ty, $descr:literal) => {
        impl Element for $t {
            const DESCR: &'static str = $descr;

            fn put(self, out: &mut Vec<u8>) {
                out.extend_from_slice(&self.to_le_bytes());
            }
        }
    };
}

element!(f32, "<f4");
element!(i8, "|i1");
element!(i16, "<i2");
element!(i32, "<i4");
element!(i64, "<i8");
element!(u8, "|u1");
element!(u16, "<u2");
element!(u64, "<u8");

impl Element for bool {
    const DESCR: &'static str = "|b1";

    fn put(self, out: &mut Vec<u8>) {
        out.push(u8::from(self));
    }
}

/// The `.npy` (version 1.0) header of a C-order array: magic, version,
/// then a Python dict literal padded so the data starts on a multiple of
/// 64 bytes.
fn header(descr: &str, shape: &[usize]) -> Vec<u8> {
    let dims: Vec<String> = shape.iter().map(usize::to_string).collect();
    let shape = match dims.len() {
        1 => format!("({},)", dims[0]),
        _ => format!("({})", dims.join(", ")),
    };
    let mut dict = format!("{{'descr': '{descr}', 'fortran_order': False, 'shape': {shape}, }}");
    // Magic (6), version (2) and length (2) come first; a newline ends it.
    let unpadded = 10 + dict.len() + 1;
    dict.push_str(&" ".repeat(unpadded.next_multiple_of(64) - unpadded));
    dict.push('\n');
    let mut out = b"\x93NUMPY\x01\x00".to_vec();
    out.extend_from_slice(&u16::try_from(dict.len()).expect("a short header").to_le_bytes());
    out.extend_from_slice(dict.as_bytes());
    out
}

/// Writes arrays into an `.npz` archive, one at a time.
pub struct NpzWriter<W: Write + Seek> {
    zip: ZipWriter<W>,
}

impl NpzWriter<BufWriter<File>> {
    pub fn create(path: &Path) -> io::Result<Self> {
        Ok(NpzWriter::new(BufWriter::new(File::create(path)?)))
    }
}

impl<W: Write + Seek> NpzWriter<W> {
    pub fn new(out: W) -> Self {
        NpzWriter {
            zip: ZipWriter::new(out),
        }
    }

    /// Adds `data` as array `name` (`name.npy` in the archive) of `shape`.
    pub fn array<T: Element>(&mut self, name: &str, shape: &[usize], data: &[T]) -> io::Result<()> {
        assert_eq!(
            shape.iter().product::<usize>(),
            data.len(),
            "{name}: shape and data disagree"
        );
        self.start(name, T::DESCR, shape)?;
        let mut buf = Vec::with_capacity(1 << 16);
        for chunk in data.chunks(1 << 14) {
            buf.clear();
            for &x in chunk {
                x.put(&mut buf);
            }
            self.zip.write_all(&buf)?;
        }
        Ok(())
    }

    /// Adds an array whose little-endian values `data` reads, `descr` being
    /// their [`Element::DESCR`].
    pub fn raw(&mut self, name: &str, descr: &str, shape: &[usize], mut data: impl Read) -> io::Result<()> {
        self.start(name, descr, shape)?;
        io::copy(&mut data, &mut self.zip)?;
        Ok(())
    }

    fn start(&mut self, name: &str, descr: &str, shape: &[usize]) -> io::Result<()> {
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .compression_level(Some(LEVEL))
            .last_modified_time(DateTime::default())
            .large_file(true);
        self.zip.start_file(format!("{name}.npy"), options)?;
        self.zip.write_all(&header(descr, shape))
    }

    pub fn finish(self) -> io::Result<W> {
        self.zip.finish().map_err(io::Error::other)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headers_are_padded_to_64_bytes() {
        for shape in [&[3][..], &[2, 54, 57], &[0, 160]] {
            let h = header("<f4", shape);
            assert_eq!(h.len() % 64, 0);
            assert!(h.ends_with(b"\n"));
        }
        let h = header("<f4", &[3]);
        assert!(String::from_utf8_lossy(&h).contains("'shape': (3,)"));
    }

    #[test]
    fn writes_a_zip_of_npy_files() {
        let mut w = NpzWriter::new(io::Cursor::new(Vec::new()));
        w.array("x", &[2, 2], &[1.0f32, 2.0, 3.0, 4.0]).unwrap();
        w.array("ok", &[3], &[true, false, true]).unwrap();
        let bytes = w.finish().unwrap().into_inner();
        let zip = zip::ZipArchive::new(io::Cursor::new(&bytes)).unwrap();
        let names: Vec<&str> = zip.file_names().collect();
        assert_eq!(names.len(), 2);
        assert!(names.contains(&"x.npy") && names.contains(&"ok.npy"));

        // The same arrays make the same bytes.
        let mut again = NpzWriter::new(io::Cursor::new(Vec::new()));
        again.array("x", &[2, 2], &[1.0f32, 2.0, 3.0, 4.0]).unwrap();
        again.array("ok", &[3], &[true, false, true]).unwrap();
        assert_eq!(again.finish().unwrap().into_inner(), bytes);
    }
}
