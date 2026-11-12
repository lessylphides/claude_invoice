// 테스트용 가짜 국세청 보안메일 만들기 (실제 사업자 정보 없음)
// 실제 메일과 같은 구조: 헤더 XOR 0x6B, 열쇠 MD5(번호), SEED-CBC IV 0, 첨부는 Base64 를 한 번 더 감쌈
import { md5, toHex, seedCbcEncrypt } from '../../etax-viewer/etax.js';

export const SAMPLE_ID = '1234567890';

export const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<TaxInvoice xmlns="urn:kr:or:kec:standard:Tax:ReusableAggregateBusinessInformationEntitySchemaModule:1:0">
  <ExchangedDocument><IssueDateTime>20261030165010</IssueDateTime></ExchangedDocument>
  <TaxInvoiceDocument>
    <IssueID>202610301000000012345678</IssueID>
    <TypeCode>0101</TypeCode>
    <DescriptionText>시험용 비고</DescriptionText>
    <IssueDateTime>20261030</IssueDateTime>
    <PurposeCode>02</PurposeCode>
  </TaxInvoiceDocument>
  <TaxInvoiceTradeSettlement>
    <InvoicerParty>
      <ID>1112233333</ID><TypeCode>도소매</TypeCode><NameText>(주) 시험공급</NameText><ClassificationCode>식품</ClassificationCode>
      <SpecifiedOrganization><TaxRegistrationID>0</TaxRegistrationID></SpecifiedOrganization>
      <SpecifiedPerson><NameText>김공급</NameText></SpecifiedPerson>
      <DefinedContact><URICommunication>seller@example.com</URICommunication></DefinedContact>
      <SpecifiedAddress><LineOneText>서울특별시 어딘가 1</LineOneText></SpecifiedAddress>
    </InvoicerParty>
    <InvoiceeParty>
      <ID>${SAMPLE_ID}</ID><TypeCode>음식점업</TypeCode><NameText>시험카페</NameText><ClassificationCode>카페</ClassificationCode>
      <SpecifiedOrganization><TaxRegistrationID>0</TaxRegistrationID></SpecifiedOrganization>
      <SpecifiedPerson><NameText>이받음</NameText></SpecifiedPerson>
      <PrimaryDefinedContact><URICommunication>buyer@example.com</URICommunication></PrimaryDefinedContact>
      <SpecifiedAddress><LineOneText>서울특별시 다른곳 2</LineOneText></SpecifiedAddress>
    </InvoiceeParty>
    <SpecifiedPaymentMeans><TypeCode>10</TypeCode><PaidAmount>33000</PaidAmount></SpecifiedPaymentMeans>
    <SpecifiedMonetarySummation>
      <ChargeTotalAmount>30000</ChargeTotalAmount><TaxTotalAmount>3000</TaxTotalAmount><GrandTotalAmount>33000</GrandTotalAmount>
    </SpecifiedMonetarySummation>
  </TaxInvoiceTradeSettlement>
  <TaxInvoiceTradeLineItem>
    <SequenceNumeric>1</SequenceNumeric><InvoiceAmount>20000</InvoiceAmount><ChargeableUnitQuantity>2.00</ChargeableUnitQuantity>
    <InformationText>1kg</InformationText><NameText>원두</NameText><PurchaseExpiryDateTime>20261030</PurchaseExpiryDateTime>
    <TotalTax><CalculatedAmount>2000</CalculatedAmount></TotalTax><UnitPrice><UnitAmount>10000</UnitAmount></UnitPrice>
  </TaxInvoiceTradeLineItem>
  <TaxInvoiceTradeLineItem>
    <SequenceNumeric>2</SequenceNumeric><InvoiceAmount>10000</InvoiceAmount><ChargeableUnitQuantity>1.00</ChargeableUnitQuantity>
    <NameText>우유 &lt;1L&gt;</NameText><PurchaseExpiryDateTime>20261030</PurchaseExpiryDateTime>
    <TotalTax><CalculatedAmount>1000</CalculatedAmount></TotalTax><UnitPrice><UnitAmount>10000</UnitAmount></UnitPrice>
  </TaxInvoiceTradeLineItem>
</TaxInvoice>`;

export const SAMPLE_BODY = `<html><body><table><tr><td>전자세금계산서 시험 화면</td></tr></table>
<img src="https://example.invalid/read-receipt.gif"><script>document.body.dataset.ran = '1'</script></body></html>`;

const enc = new TextEncoder();
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

export function makeSecureMail({ id = SAMPLE_ID, xml = SAMPLE_XML, body = SAMPLE_BODY, xmlName = '202610301000000012345678.xml' } = {}) {
  const key = md5(id);
  const iv = new Uint8Array(16);
  const seal = (bytes) => b64(seedCbcEncrypt(key, iv, bytes));
  const header = [
    'ContentEncryptionAlgorithm:2',
    'HintKey:사업자등록번호(10자리)를 입력하시기 바랍니다.',
    `HashKey:${seal(enc.encode(toHex(key)))}`,
    'AttachFileCount:1',
    `AttachFileName:${xmlName}`,
    'AttachFileTagID:idCriAttachContents0',
    `AttachFileSize:${enc.encode(xml).length}`,
    '',
  ].join('\r\n');
  const headerB64 = b64(enc.encode(header).map((b) => b ^ 0x6b));
  const sealedBody = seal(enc.encode(body));
  const sealedXml = seal(enc.encode(b64(enc.encode(xml))));
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>보안메일</title></head><body>
<input type="hidden" id="idCriHeader" value="${headerB64}">
<input type="hidden" id="idCriPcContents" value="${sealedBody}">
<input type="hidden" id="idCriMobileContents" value="${sealedBody}">
<input type="hidden" id="idCriAttachContents0" value="${sealedXml}">
</body></html>`;
}
